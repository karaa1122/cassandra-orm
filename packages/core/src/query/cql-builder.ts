import type {
  ColumnMetadata,
  EntityMetadata,
} from '../metadata/entity-metadata';
import type { OrderDirection, Restriction } from './where';

export interface Statement {
  query: string;
  params: unknown[];
}

/** Bound as text: cassandra-driver accepts strings for bigint in every encoding mode. */
export type Int64 = number | bigint;

export interface SelectSpec {
  restrictions: readonly Restriction[];
  orderBy?: ReadonlyArray<{
    column: ColumnMetadata;
    direction: OrderDirection;
  }>;
  limit?: number;
  allowFiltering?: boolean;
}

export interface InsertSpec {
  /** Value per column; `undefined` entries are left unset. */
  values: ReadonlyMap<ColumnMetadata, unknown>;
  unset: unknown;
  ifNotExists?: boolean;
  ttl?: number;
  timestamp?: Int64;
}

export interface Assignment {
  column: ColumnMetadata;
  value: unknown;
  /** `set` replaces the value, `increment` adds to a counter. */
  mode: 'set' | 'increment';
}

export interface UpdateSpec {
  restrictions: readonly Restriction[];
  assignments: readonly Assignment[];
  ifExists?: boolean;
  conditions?: readonly Restriction[];
  ttl?: number;
  timestamp?: Int64;
}

export interface DeleteSpec {
  restrictions: readonly Restriction[];
  ifExists?: boolean;
  conditions?: readonly Restriction[];
  timestamp?: Int64;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function tableName(metadata: EntityMetadata): string {
  const table = quoteIdentifier(metadata.table);
  return metadata.keyspace
    ? `${quoteIdentifier(metadata.keyspace)}.${table}`
    : table;
}

export function buildSelect(
  metadata: EntityMetadata,
  spec: SelectSpec,
): Statement {
  const params: unknown[] = [];
  const columns = metadata.columns.map((c) => quoteIdentifier(c.name));
  let query = `SELECT ${columns.join(', ')} FROM ${tableName(metadata)}`;

  if (spec.restrictions.length > 0) {
    query += ` WHERE ${relations(spec.restrictions, params)}`;
  }
  if (spec.orderBy?.length) {
    const order = spec.orderBy.map(
      ({ column, direction }) => `${quoteIdentifier(column.name)} ${direction}`,
    );
    query += ` ORDER BY ${order.join(', ')}`;
  }
  if (spec.limit !== undefined) {
    query += ' LIMIT ?';
    params.push(spec.limit);
  }
  if (spec.allowFiltering) {
    query += ' ALLOW FILTERING';
  }
  return { query, params };
}

/**
 * Always lists every column so each table has a single prepared INSERT;
 * missing values are bound as `unset`, which (unlike null) writes no
 * tombstone.
 */
export function buildInsert(
  metadata: EntityMetadata,
  spec: InsertSpec,
): Statement {
  const columns = metadata.columns;
  const params = columns.map((column) => {
    const value = spec.values.get(column);
    return value === undefined ? spec.unset : value;
  });

  let query =
    `INSERT INTO ${tableName(metadata)} (${columns.map((c) => quoteIdentifier(c.name)).join(', ')}) ` +
    `VALUES (${columns.map(() => '?').join(', ')})`;
  if (spec.ifNotExists) {
    query += ' IF NOT EXISTS';
  }
  query += usingClause(spec, params);
  return { query, params };
}

export function buildUpdate(
  metadata: EntityMetadata,
  spec: UpdateSpec,
): Statement {
  const params: unknown[] = [];
  let query = `UPDATE ${tableName(metadata)}`;
  query += usingClause(spec, params);

  const assignments = spec.assignments.map(({ column, value, mode }) => {
    const name = quoteIdentifier(column.name);
    params.push(mode === 'increment' ? String(value) : value);
    return mode === 'increment' ? `${name} = ${name} + ?` : `${name} = ?`;
  });
  query += ` SET ${assignments.join(', ')}`;
  query += ` WHERE ${relations(spec.restrictions, params)}`;
  query += conditionClause(spec, params);
  return { query, params };
}

export function buildDelete(
  metadata: EntityMetadata,
  spec: DeleteSpec,
): Statement {
  const params: unknown[] = [];
  let query = `DELETE FROM ${tableName(metadata)}`;
  query += usingClause({ timestamp: spec.timestamp }, params);
  query += ` WHERE ${relations(spec.restrictions, params)}`;
  query += conditionClause(spec, params);
  return { query, params };
}

export function buildCreateTable(
  metadata: EntityMetadata,
  { ifNotExists = true } = {},
): string {
  const definitions = metadata.columns.map(
    (c) =>
      `  ${quoteIdentifier(c.name)} ${c.type}${c.kind === 'static' ? ' STATIC' : ''}`,
  );

  const partition = metadata.partitionKeys.map((c) => quoteIdentifier(c.name));
  const partitionKey =
    partition.length === 1 ? partition[0] : `(${partition.join(', ')})`;
  const primaryKey = [
    partitionKey,
    ...metadata.clusteringKeys.map((c) => quoteIdentifier(c.name)),
  ];
  definitions.push(`  PRIMARY KEY (${primaryKey.join(', ')})`);

  let cql =
    `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${tableName(metadata)} (\n` +
    `${definitions.join(',\n')}\n)`;
  if (metadata.clusteringKeys.length > 0) {
    const order = metadata.clusteringKeys.map(
      (c) => `${quoteIdentifier(c.name)} ${c.order}`,
    );
    cql += ` WITH CLUSTERING ORDER BY (${order.join(', ')})`;
  }
  return cql;
}

function relations(restrictions: readonly Restriction[], params: unknown[]) {
  return restrictions
    .map(({ column, operator, value }) => {
      params.push(value);
      return `${quoteIdentifier(column.name)} ${operator} ?`;
    })
    .join(' AND ');
}

function usingClause(
  spec: { ttl?: number; timestamp?: Int64 },
  params: unknown[],
): string {
  const parts: string[] = [];
  if (spec.ttl !== undefined) {
    parts.push('TTL ?');
    params.push(spec.ttl);
  }
  if (spec.timestamp !== undefined) {
    parts.push('TIMESTAMP ?');
    params.push(String(spec.timestamp));
  }
  return parts.length > 0 ? ` USING ${parts.join(' AND ')}` : '';
}

function conditionClause(
  spec: { ifExists?: boolean; conditions?: readonly Restriction[] },
  params: unknown[],
): string {
  if (spec.ifExists) return ' IF EXISTS';
  if (spec.conditions?.length)
    return ` IF ${relations(spec.conditions, params)}`;
  return '';
}
