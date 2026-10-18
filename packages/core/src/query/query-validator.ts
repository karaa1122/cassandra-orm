import { InvalidQueryError } from '../errors';
import type {
  ColumnMetadata,
  EntityMetadata,
} from '../metadata/entity-metadata';
import { isRange, type OrderDirection, type Restriction } from './where';

export interface SelectValidationOptions {
  allowFiltering?: boolean;
  orderBy?: ReadonlyArray<{
    column: ColumnMetadata;
    direction: OrderDirection;
  }>;
}

/**
 * Checks a SELECT against the primary key the way Cassandra will, so mistakes
 * surface as readable errors instead of server rejections or accidental
 * cluster-wide scans.
 */
export function validateSelect(
  metadata: EntityMetadata,
  restrictions: readonly Restriction[],
  { allowFiltering = false, orderBy = [] }: SelectValidationOptions = {},
): void {
  const byColumn = groupByColumn(restrictions);
  const reasons: string[] = [];

  for (const column of metadata.columns) {
    if (
      (column.kind === 'regular' || column.kind === 'static') &&
      byColumn.has(column)
    ) {
      reasons.push(`"${column.propertyName}" is not part of the primary key`);
    }
  }

  const partition = checkPartitionKey(metadata, byColumn);
  if (partition.problem) reasons.push(partition.problem);

  const restrictedClustering = metadata.clusteringKeys.filter((c) =>
    byColumn.has(c),
  );
  if (restrictedClustering.length > 0 && !partition.complete) {
    reasons.push(
      'clustering columns are restricted without the full partition key',
    );
  } else {
    reasons.push(...checkClusteringPrefix(metadata, byColumn));
  }

  if (reasons.length > 0 && !allowFiltering) {
    throw new InvalidQueryError(
      `Query on ${metadata.target.name} would require ALLOW FILTERING: ${reasons.join('; ')}. ` +
        'Query by the primary key, or pass allowFiltering: true if scanning is acceptable.',
    );
  }

  if (orderBy.length > 0) {
    validateOrderBy(metadata, orderBy, partition.complete);
  }
}

export function validateUpdate(
  metadata: EntityMetadata,
  restrictions: readonly Restriction[],
  { conditional = false } = {},
): void {
  const byColumn = groupByColumn(restrictions);
  rejectNonKeyColumns(metadata, byColumn, 'update');

  for (const column of [
    ...metadata.partitionKeys,
    ...metadata.clusteringKeys,
  ]) {
    const columnRestrictions = byColumn.get(column);
    if (!columnRestrictions) {
      throw new InvalidQueryError(
        `update on ${metadata.target.name} needs the full primary key; "${column.propertyName}" is missing`,
      );
    }
    assertEquality(metadata, column, columnRestrictions, 'update', conditional);
  }
}

export function validateDelete(
  metadata: EntityMetadata,
  restrictions: readonly Restriction[],
  { conditional = false } = {},
): void {
  const byColumn = groupByColumn(restrictions);
  rejectNonKeyColumns(metadata, byColumn, 'delete');

  for (const column of metadata.partitionKeys) {
    const columnRestrictions = byColumn.get(column);
    if (!columnRestrictions) {
      throw new InvalidQueryError(
        `delete on ${metadata.target.name} needs the full partition key; "${column.propertyName}" is missing`,
      );
    }
    assertEquality(metadata, column, columnRestrictions, 'delete', conditional);
  }

  if (conditional) {
    // Conditional deletes must target exactly one row.
    for (const column of metadata.clusteringKeys) {
      const columnRestrictions = byColumn.get(column);
      if (!columnRestrictions) {
        throw new InvalidQueryError(
          `conditional delete on ${metadata.target.name} needs the full primary key; "${column.propertyName}" is missing`,
        );
      }
      assertEquality(metadata, column, columnRestrictions, 'delete', true);
    }
    return;
  }

  const problems = checkClusteringPrefix(metadata, byColumn);
  if (problems.length > 0) {
    throw new InvalidQueryError(
      `delete on ${metadata.target.name} is invalid: ${problems.join('; ')}`,
    );
  }
}

type RestrictionsByColumn = Map<ColumnMetadata, Restriction[]>;

function groupByColumn(
  restrictions: readonly Restriction[],
): RestrictionsByColumn {
  const map: RestrictionsByColumn = new Map();
  for (const restriction of restrictions) {
    const list = map.get(restriction.column) ?? [];
    list.push(restriction);
    map.set(restriction.column, list);
  }
  return map;
}

function checkPartitionKey(
  metadata: EntityMetadata,
  byColumn: RestrictionsByColumn,
): { complete: boolean; problem?: string } {
  const missing = metadata.partitionKeys.filter((c) => !byColumn.has(c));
  const ranged = metadata.partitionKeys.filter((c) =>
    byColumn.get(c)?.some((r) => isRange(r.operator)),
  );

  if (ranged.length > 0) {
    return {
      complete: false,
      problem: `partition key column ${names(ranged)} can only be compared with equality or $in`,
    };
  }
  if (missing.length === metadata.partitionKeys.length) {
    return { complete: false };
  }
  if (missing.length > 0) {
    return {
      complete: false,
      problem: `the partition key is incomplete (missing ${names(missing)})`,
    };
  }
  return { complete: true };
}

/**
 * Clustering columns must be restricted in order, without gaps, and only the
 * last restricted one may use a range.
 */
function checkClusteringPrefix(
  metadata: EntityMetadata,
  byColumn: RestrictionsByColumn,
): string[] {
  const problems: string[] = [];
  let blocker:
    { column: ColumnMetadata; reason: 'missing' | 'range' } | undefined;

  for (const column of metadata.clusteringKeys) {
    const restrictions = byColumn.get(column);
    if (!restrictions) {
      blocker ??= { column, reason: 'missing' };
      continue;
    }
    if (blocker) {
      problems.push(
        blocker.reason === 'missing'
          ? `clustering column "${column.propertyName}" is restricted but the preceding "${blocker.column.propertyName}" is not`
          : `clustering column "${column.propertyName}" is restricted after a range on "${blocker.column.propertyName}"`,
      );
      continue;
    }
    if (restrictions.some((r) => isRange(r.operator))) {
      blocker = { column, reason: 'range' };
    }
  }

  return problems;
}

function validateOrderBy(
  metadata: EntityMetadata,
  orderBy: NonNullable<SelectValidationOptions['orderBy']>,
  partitionComplete: boolean,
): void {
  const entity = metadata.target.name;
  if (!partitionComplete) {
    throw new InvalidQueryError(
      `orderBy on ${entity} requires the full partition key in the where clause`,
    );
  }

  let reversed: boolean | undefined;
  orderBy.forEach(({ column, direction }, index) => {
    if (column.kind !== 'clustering') {
      throw new InvalidQueryError(
        `orderBy on ${entity}: only clustering columns can be ordered, "${column.propertyName}" is not one`,
      );
    }
    if (metadata.clusteringKeys[index] !== column) {
      throw new InvalidQueryError(
        `orderBy on ${entity} must follow the clustering column order: ${names(metadata.clusteringKeys)}`,
      );
    }
    const isReversed = direction !== column.order;
    if (reversed !== undefined && reversed !== isReversed) {
      throw new InvalidQueryError(
        `orderBy on ${entity} must use the table's clustering order or its exact reverse`,
      );
    }
    reversed = isReversed;
  });
}

function rejectNonKeyColumns(
  metadata: EntityMetadata,
  byColumn: RestrictionsByColumn,
  statement: string,
): void {
  for (const column of byColumn.keys()) {
    if (column.kind === 'regular' || column.kind === 'static') {
      throw new InvalidQueryError(
        `${statement} on ${metadata.target.name} can only be keyed by primary key columns; ` +
          `put "${column.propertyName}" in the \`if\` option to make it a condition`,
      );
    }
  }
}

function assertEquality(
  metadata: EntityMetadata,
  column: ColumnMetadata,
  restrictions: Restriction[],
  statement: string,
  conditional: boolean,
): void {
  for (const { operator } of restrictions) {
    if (isRange(operator)) {
      throw new InvalidQueryError(
        `${statement} on ${metadata.target.name}: "${column.propertyName}" must be compared with equality`,
      );
    }
    if (operator === 'IN' && conditional) {
      throw new InvalidQueryError(
        `${statement} on ${metadata.target.name}: $in is not allowed on "${column.propertyName}" in a conditional (LWT) statement`,
      );
    }
  }
}

function names(columns: readonly ColumnMetadata[]): string {
  return columns.map((c) => `"${c.propertyName}"`).join(', ');
}
