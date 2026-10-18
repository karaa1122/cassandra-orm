import { EntityMetadataError } from '../errors';
import {
  buildColumnMetadata,
  type ColumnDefinition,
  type ColumnMetadata,
  type EntityClass,
  type EntityMetadata,
  type RelationMetadata,
  type TableDefinition,
} from './entity-metadata';

/**
 * Collects what the decorators declare and turns it into validated
 * {@link EntityMetadata}. Kept on `globalThis` so that two copies of this
 * package in one process (e.g. CJS and ESM) still share entity definitions.
 */
export class MetadataStorage {
  private readonly tables = new Map<Function, TableDefinition>();
  private readonly columns = new Map<Function, ColumnDefinition[]>();
  private readonly relations = new Map<Function, RelationMetadata[]>();
  private readonly built = new Map<Function, EntityMetadata>();

  addTable(target: Function, definition: TableDefinition): void {
    this.tables.set(target, definition);
    this.built.clear();
  }

  addColumn(target: Function, definition: ColumnDefinition): void {
    const own = this.columns.get(target) ?? [];
    if (own.some((c) => c.propertyName === definition.propertyName)) {
      throw new EntityMetadataError(
        `${target.name}.${definition.propertyName} has more than one column decorator`,
      );
    }
    own.push(definition);
    this.columns.set(target, own);
    this.built.clear();
  }

  addRelation(target: Function, relation: RelationMetadata): void {
    const own = this.relations.get(target) ?? [];
    own.push(relation);
    this.relations.set(target, own);
    this.built.clear();
  }

  hasTable(target: Function): boolean {
    return this.tables.has(target);
  }

  getEntityMetadata(target: EntityClass): EntityMetadata {
    const cached = this.built.get(target);
    if (cached) return cached;

    const metadata = this.build(target);
    this.built.set(target, metadata);
    return metadata;
  }

  private build(target: EntityClass): EntityMetadata {
    const table = this.tables.get(target);
    if (!table) {
      throw new EntityMetadataError(
        `${target.name} is not an entity. Decorate it with @Table().`,
      );
    }

    const columns = this.collectColumns(target).map(buildColumnMetadata);
    const partitionKeys = columns.filter((c) => c.kind === 'partition');
    const clusteringKeys = columns.filter((c) => c.kind === 'clustering');

    if (partitionKeys.length === 0) {
      throw new EntityMetadataError(
        `${target.name} has no @PartitionKey(). Every Cassandra table needs at least one.`,
      );
    }

    const seen = new Map<string, ColumnMetadata>();
    for (const column of columns) {
      const clash = seen.get(column.name);
      if (clash) {
        throw new EntityMetadataError(
          `${target.name}.${column.propertyName} and ${target.name}.${clash.propertyName} both map to column "${column.name}"`,
        );
      }
      seen.set(column.name, column);
    }

    const counters = columns.filter((c) => c.type === 'counter');
    if (
      counters.some((c) => c.kind === 'partition' || c.kind === 'clustering')
    ) {
      throw new EntityMetadataError(
        `${target.name}: counter columns cannot be part of the primary key`,
      );
    }
    const regular = columns.filter(
      (c) => c.kind === 'regular' || c.kind === 'static',
    );
    if (counters.length > 0 && counters.length !== regular.length) {
      throw new EntityMetadataError(
        `${target.name}: a table with counter columns may only contain counters outside its primary key`,
      );
    }
    if (
      clusteringKeys.length === 0 &&
      columns.some((c) => c.kind === 'static')
    ) {
      throw new EntityMetadataError(
        `${target.name}: static columns require at least one @ClusteringKey()`,
      );
    }

    const byProperty = new Map(columns.map((c) => [c.propertyName, c]));
    const relations = this.collect(
      this.relations,
      target,
      (r) => r.propertyName,
    );
    for (const relation of relations) {
      const where = `${target.name}.${relation.propertyName}`;
      if (byProperty.has(relation.propertyName)) {
        throw new EntityMetadataError(
          `${where} cannot be both a column and a relation`,
        );
      }
      const sourceProperties = Object.keys(relation.on);
      if (sourceProperties.length === 0) {
        throw new EntityMetadataError(
          `${where}: relation "on" mapping is empty`,
        );
      }
      for (const property of sourceProperties) {
        if (!byProperty.has(property)) {
          throw new EntityMetadataError(
            `${where}: "${property}" in the "on" mapping is not a column of ${target.name}`,
          );
        }
      }
    }
    const relationsByProperty = new Map(
      relations.map((r) => [r.propertyName, r]),
    );

    return {
      target,
      table: table.table,
      keyspace: table.keyspace,
      columns,
      partitionKeys,
      clusteringKeys,
      isCounterTable: counters.length > 0,
      relations,
      findColumn: (propertyName) => byProperty.get(propertyName),
      findRelation: (propertyName) => relationsByProperty.get(propertyName),
    };
  }

  /** Columns from base classes first, so inherited keys keep their position. */
  private collectColumns(target: Function): ColumnDefinition[] {
    return this.collect(this.columns, target, (c) => c.propertyName);
  }

  /**
   * Walks the prototype chain from the base class down; a subclass
   * redeclaring a property replaces it in place.
   */
  private collect<T>(
    source: Map<Function, T[]>,
    target: Function,
    keyOf: (item: T) => string,
  ): T[] {
    const chain: Function[] = [];
    for (
      let current: unknown = target;
      typeof current === 'function' && current !== Function.prototype;
      current = Object.getPrototypeOf(current)
    ) {
      chain.unshift(current as Function);
    }

    const byKey = new Map<string, T>();
    for (const ctor of chain) {
      for (const item of source.get(ctor) ?? []) {
        byKey.set(keyOf(item), item);
      }
    }
    return [...byKey.values()];
  }
}

const STORAGE_KEY = Symbol.for('@cassandra-orm/core:metadata-storage');

export function getMetadataStorage(): MetadataStorage {
  const holder = globalThis as { [STORAGE_KEY]?: MetadataStorage };
  return (holder[STORAGE_KEY] ??= new MetadataStorage());
}

export function getEntityMetadata(target: EntityClass): EntityMetadata {
  return getMetadataStorage().getEntityMetadata(target);
}
