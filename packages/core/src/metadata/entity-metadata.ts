import { parseCqlType, type CqlType, type ParsedCqlType } from '../cql-types';
import { EntityMetadataError } from '../errors';

export type EntityClass<T = any> = abstract new (...args: any[]) => T;

export type ColumnKind = 'partition' | 'clustering' | 'regular' | 'static';

export type ClusteringOrder = 'ASC' | 'DESC';

export interface ColumnMetadata {
  /** Property name on the entity class. */
  readonly propertyName: string;
  /** Column name in Cassandra. */
  readonly name: string;
  readonly type: CqlType;
  readonly parsedType: ParsedCqlType;
  readonly kind: ColumnKind;
  /** Only set for clustering columns. */
  readonly order?: ClusteringOrder;
}

export type RelationKind = 'belongsTo' | 'hasMany';

export interface RelationMetadata {
  readonly propertyName: string;
  readonly kind: RelationKind;
  /** Thunk, so entities can reference each other across files. */
  readonly target: () => EntityClass;
  /** Source property -> target property used to look related rows up. */
  readonly on: Readonly<Record<string, string>>;
}

export interface EntityMetadata {
  readonly target: EntityClass;
  readonly table: string;
  readonly keyspace?: string;
  /** Every column, in declaration order (base classes first). */
  readonly columns: readonly ColumnMetadata[];
  readonly partitionKeys: readonly ColumnMetadata[];
  readonly clusteringKeys: readonly ColumnMetadata[];
  /** True when the table holds counter columns. */
  readonly isCounterTable: boolean;
  readonly relations: readonly RelationMetadata[];
  findColumn(propertyName: string): ColumnMetadata | undefined;
  findRelation(propertyName: string): RelationMetadata | undefined;
}

export interface ColumnDefinition {
  propertyName: string;
  name: string;
  type: CqlType;
  kind: ColumnKind;
  order?: ClusteringOrder;
}

export interface TableDefinition {
  table: string;
  keyspace?: string;
}

export function buildColumnMetadata(def: ColumnDefinition): ColumnMetadata {
  let parsedType: ParsedCqlType;
  try {
    parsedType = parseCqlType(def.type);
  } catch (error) {
    throw new EntityMetadataError(
      `Invalid type for column "${def.propertyName}": ${(error as Error).message}`,
    );
  }
  return { ...def, parsedType };
}
