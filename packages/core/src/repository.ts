import { types, type Client, type QueryOptions } from 'cassandra-driver';
import { fromDriverValue } from './cql-types';
import { InvalidQueryError } from './errors';
import type {
  ColumnMetadata,
  EntityClass,
  EntityMetadata,
} from './metadata/entity-metadata';
import { getEntityMetadata } from './metadata/metadata-storage';
import {
  buildDelete,
  buildInsert,
  buildSelect,
  buildUpdate,
  type Assignment,
  type Int64,
  type Statement,
} from './query/cql-builder';
import type { Include } from './relations/include';
import { loadRelations } from './relations/relation-loader';
import {
  validateDelete,
  validateSelect,
  validateUpdate,
} from './query/query-validator';
import {
  normalizeWhere,
  resolveColumn,
  type EntityData,
  type EntityProperty,
  type OrderBy,
  type OrderDirection,
  type Where,
} from './query/where';

/** Driver options that may be set per query. */
export type ExecutionOptions = Pick<
  QueryOptions,
  | 'consistency'
  | 'serialConsistency'
  | 'executionProfile'
  | 'readTimeout'
  | 'isIdempotent'
  | 'traceQuery'
>;

const EXECUTION_OPTION_KEYS = [
  'consistency',
  'serialConsistency',
  'executionProfile',
  'readTimeout',
  'isIdempotent',
  'traceQuery',
] as const satisfies ReadonlyArray<keyof ExecutionOptions>;

export interface FindOptions<T> extends ExecutionOptions {
  /** Maximum number of rows returned. */
  limit?: number;
  orderBy?: OrderBy<T>;
  /** Opt in to queries Cassandra can only answer by scanning. */
  allowFiltering?: boolean;
  /** Rows fetched per round trip while iterating. Driver default: 5000. */
  fetchSize?: number;
  /**
   * Relations to load after the main query, with one extra query per
   * distinct key (Cassandra has no joins).
   */
  include?: Include<T>;
}

export interface FindPageOptions<T> extends Omit<FindOptions<T>, 'fetchSize'> {
  /** Rows per page. Defaults to 100. */
  pageSize?: number;
  /** Cursor returned by the previous page. */
  pageState?: string | null;
}

export interface Page<T> {
  items: T[];
  /** Pass to the next `findPage` call; `null` on the last page. */
  pageState: string | null;
}

export interface WriteOptions extends ExecutionOptions {
  /** Write timestamp in microseconds since epoch (`USING TIMESTAMP`). */
  timestamp?: Int64;
}

export interface InsertOptions extends WriteOptions {
  /** Seconds until the written cells expire. */
  ttl?: number;
  /** Lightweight transaction: only insert if the row is absent. */
  ifNotExists?: boolean;
}

export interface UpdateOptions<T> extends WriteOptions {
  ttl?: number;
  /** Lightweight transaction: only update an existing row. */
  ifExists?: boolean;
  /** Lightweight transaction: only update when these columns match. */
  if?: Where<T>;
}

export interface DeleteOptions<T> extends WriteOptions {
  ifExists?: boolean;
  if?: Where<T>;
}

export interface WriteResult {
  /** False only when a lightweight transaction's condition failed. */
  applied: boolean;
}

export class Repository<T extends object> {
  constructor(
    readonly client: Client,
    readonly metadata: EntityMetadata,
  ) {}

  /** Every matching row, fetching further pages as needed. */
  async find(where: Where<T> = {}, options: FindOptions<T> = {}): Promise<T[]> {
    const { include, ...iterateOptions } = options;
    const items: T[] = [];
    for await (const item of this.iterate(where, iterateOptions)) {
      items.push(item);
    }
    await this.include(items, include);
    return items;
  }

  async findOne(
    where: Where<T>,
    options: Omit<FindOptions<T>, 'limit' | 'fetchSize'> = {},
  ): Promise<T | null> {
    const statement = this.select(where, { ...options, limit: 1 });
    const result = await this.execute(statement, options, {
      isIdempotent: true,
    });
    const row = result.first();
    if (!row) return null;
    const entity = this.toEntity(row);
    await this.include([entity], options.include);
    return entity;
  }

  /** One page of results plus a cursor for the next one. */
  async findPage(
    where: Where<T>,
    options: FindPageOptions<T> = {},
  ): Promise<Page<T>> {
    assertInteger('pageSize', options.pageSize, 1);
    const statement = this.select(where, options);
    const result = await this.execute(statement, options, {
      isIdempotent: true,
      fetchSize: options.pageSize ?? 100,
      pageState: options.pageState ?? undefined,
    });
    const items = result.rows.map((row) => this.toEntity(row));
    await this.include(items, options.include);
    return { items, pageState: result.pageState ?? null };
  }

  /**
   * Streams matching rows, fetching pages lazily. Relations cannot be
   * included here; use `findPage` to load them in batches.
   */
  async *iterate(
    where: Where<T> = {},
    options: Omit<FindOptions<T>, 'include'> = {},
  ): AsyncGenerator<T> {
    assertInteger('fetchSize', options.fetchSize, 1);
    const statement = this.select(where, options);
    const result = await this.execute(statement, options, {
      isIdempotent: true,
      fetchSize: options.fetchSize,
    });
    for await (const row of result) {
      yield this.toEntity(row);
    }
  }

  /**
   * Writes a row. Like every Cassandra INSERT this is an upsert unless
   * `ifNotExists` is set. Properties left `undefined` are not written, and
   * properties without a column decorator are ignored.
   */
  async insert(
    entity: Partial<EntityData<T>>,
    options: InsertOptions = {},
  ): Promise<WriteResult> {
    const { metadata } = this;
    if (metadata.isCounterTable) {
      throw new InvalidQueryError(
        `${metadata.target.name} is a counter table; use increment() instead of insert()`,
      );
    }
    assertNoLwtTimestamp(options.timestamp, options.ifNotExists);
    assertWriteOptions(options);

    const values = new Map<ColumnMetadata, unknown>();
    for (const column of metadata.columns) {
      const value = (entity as Record<string, unknown>)[column.propertyName];
      if (
        (column.kind === 'partition' || column.kind === 'clustering') &&
        (value === undefined || value === null)
      ) {
        throw new InvalidQueryError(
          `Cannot insert into ${metadata.target.name}: primary key property "${column.propertyName}" is ${value}`,
        );
      }
      values.set(column, value);
    }

    const statement = buildInsert(metadata, {
      values,
      unset: types.unset,
      ifNotExists: options.ifNotExists,
      ttl: options.ttl,
      timestamp: options.timestamp,
    });
    const result = await this.execute(statement, options);
    return { applied: result.wasApplied() };
  }

  /**
   * Updates the row identified by the full primary key. `undefined` values
   * are skipped; `null` deletes the cell.
   */
  async update(
    where: Where<T>,
    changes: Partial<EntityData<T>>,
    options: UpdateOptions<T> = {},
  ): Promise<WriteResult> {
    const { metadata } = this;
    if (metadata.isCounterTable) {
      throw new InvalidQueryError(
        `${metadata.target.name} is a counter table; use increment() instead of update()`,
      );
    }

    const assignments: Assignment[] = [];
    for (const [property, value] of Object.entries(changes)) {
      const column = resolveColumn(metadata, property);
      if (column.kind === 'partition' || column.kind === 'clustering') {
        throw new InvalidQueryError(
          `Primary key property "${property}" of ${metadata.target.name} cannot be updated; insert a new row instead`,
        );
      }
      if (value !== undefined) {
        assignments.push({ column, value, mode: 'set' });
      }
    }
    if (assignments.length === 0) {
      throw new InvalidQueryError(
        `update on ${metadata.target.name} has nothing to change`,
      );
    }

    return this.runUpdate(where, assignments, options);
  }

  /** Adds (or with negative values, subtracts) to counter columns. */
  async increment(
    where: Where<T>,
    deltas: Partial<Record<EntityProperty<T>, Int64>>,
    options: Omit<UpdateOptions<T>, 'ttl' | 'ifExists' | 'if'> = {},
  ): Promise<void> {
    const assignments: Assignment[] = [];
    for (const [property, delta] of Object.entries(deltas)) {
      const column = resolveColumn(this.metadata, property);
      if (column.type !== 'counter') {
        throw new InvalidQueryError(
          `"${property}" of ${this.metadata.target.name} is not a counter column`,
        );
      }
      if (delta !== undefined) {
        assignments.push({ column, value: delta, mode: 'increment' });
      }
    }
    if (assignments.length === 0) {
      throw new InvalidQueryError(
        `increment on ${this.metadata.target.name} has nothing to change`,
      );
    }

    // Counter updates are never idempotent; the driver must not retry them.
    await this.runUpdate(where, assignments, {
      isIdempotent: false,
      ...options,
    });
  }

  /**
   * Deletes the rows matching the partition key and an optional clustering
   * prefix or range.
   */
  async delete(
    where: Where<T>,
    options: DeleteOptions<T> = {},
  ): Promise<WriteResult> {
    const restrictions = normalizeWhere(this.metadata, where);
    const conditions = options.if
      ? normalizeWhere(this.metadata, options.if, { allowNull: true })
      : [];
    const conditional = Boolean(options.ifExists) || conditions.length > 0;
    assertNoLwtTimestamp(options.timestamp, conditional);
    assertWriteOptions(options);
    validateDelete(this.metadata, restrictions, { conditional });

    const statement = buildDelete(this.metadata, {
      restrictions,
      ifExists: options.ifExists,
      conditions,
      timestamp: options.timestamp,
    });
    const result = await this.execute(statement, options);
    return { applied: result.wasApplied() };
  }

  private async runUpdate(
    where: Where<T>,
    assignments: Assignment[],
    options: UpdateOptions<T>,
  ): Promise<WriteResult> {
    const restrictions = normalizeWhere(this.metadata, where);
    const conditions = options.if
      ? normalizeWhere(this.metadata, options.if, { allowNull: true })
      : [];
    const conditional = Boolean(options.ifExists) || conditions.length > 0;
    assertNoLwtTimestamp(options.timestamp, conditional);
    assertWriteOptions(options);
    validateUpdate(this.metadata, restrictions, { conditional });

    const statement = buildUpdate(this.metadata, {
      restrictions,
      assignments,
      ifExists: options.ifExists,
      conditions,
      ttl: options.ttl,
      timestamp: options.timestamp,
    });
    const result = await this.execute(statement, options);
    return { applied: result.wasApplied() };
  }

  private select(
    where: Where<T>,
    options: Pick<FindOptions<T>, 'limit' | 'orderBy' | 'allowFiltering'>,
  ): Statement {
    const restrictions = normalizeWhere(this.metadata, where);
    const orderBy = Object.entries(options.orderBy ?? {}).map(
      ([property, direction]) => ({
        column: resolveColumn(this.metadata, property),
        direction: assertDirection(property, direction),
      }),
    );
    assertInteger('limit', options.limit, 1);
    validateSelect(this.metadata, restrictions, {
      allowFiltering: options.allowFiltering,
      orderBy,
    });
    return buildSelect(this.metadata, {
      restrictions,
      orderBy,
      limit: options.limit,
      allowFiltering: options.allowFiltering,
    });
  }

  private async include(items: T[], include: Include<T> | undefined) {
    if (!include) return;
    await loadRelations(this.metadata, items, include, (target) =>
      this.repositoryFor(target),
    );
  }

  private repositoryFor(target: EntityClass): Repository<any> {
    return target === this.metadata.target
      ? this
      : new Repository(this.client, getEntityMetadata(target));
  }

  private execute(
    statement: Statement,
    options: ExecutionOptions,
    defaults: QueryOptions = {},
  ): Promise<types.ResultSet> {
    const queryOptions: QueryOptions = { ...defaults, prepare: true };
    for (const key of EXECUTION_OPTION_KEYS) {
      if (options[key] !== undefined) {
        (queryOptions as Record<string, unknown>)[key] = options[key];
      }
    }
    return this.client.execute(statement.query, statement.params, queryOptions);
  }

  private toEntity(row: types.Row): T {
    const entity = Object.create(this.metadata.target.prototype);
    for (const column of this.metadata.columns) {
      entity[column.propertyName] = fromDriverValue(
        column.parsedType,
        row[column.name],
      );
    }
    return entity;
  }
}

function assertNoLwtTimestamp(
  timestamp: Int64 | undefined,
  conditional: boolean | undefined,
): void {
  if (timestamp !== undefined && conditional) {
    throw new InvalidQueryError(
      'Cassandra does not allow a custom timestamp on lightweight transactions',
    );
  }
}

function assertDirection(property: string, direction: unknown): OrderDirection {
  // The direction is written into the CQL text, so it must be one of exactly
  // two keywords; anything else could inject arbitrary CQL.
  if (direction !== 'ASC' && direction !== 'DESC') {
    throw new InvalidQueryError(
      `orderBy direction for "${property}" must be 'ASC' or 'DESC'`,
    );
  }
  return direction;
}

function assertInteger(name: string, value: unknown, min: number): void {
  if (value === undefined) return;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min
  ) {
    throw new InvalidQueryError(`${name} must be an integer >= ${min}`);
  }
}

function assertWriteOptions(options: {
  ttl?: number;
  timestamp?: Int64;
}): void {
  assertInteger('ttl', options.ttl, 0);
  const { timestamp } = options;
  if (
    timestamp !== undefined &&
    typeof timestamp !== 'bigint' &&
    !Number.isSafeInteger(timestamp)
  ) {
    throw new InvalidQueryError(
      'timestamp must be an integer (microseconds since epoch) or a bigint',
    );
  }
}
