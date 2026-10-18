import { InvalidQueryError } from '../errors';
import type {
  ColumnMetadata,
  EntityMetadata,
} from '../metadata/entity-metadata';

/** Names of the data (non-method) properties of an entity. */
export type EntityProperty<T> = {
  [K in keyof T]-?: T[K] extends (...args: any[]) => any ? never : K;
}[keyof T] &
  string;

/** Plain data shape of an entity. */
export type EntityData<T> = { [K in EntityProperty<T>]: T[K] };

export interface Operators<V> {
  $in?: readonly V[];
  $gt?: V;
  $gte?: V;
  $lt?: V;
  $lte?: V;
}

export type WhereValue<V> = V | Operators<NonNullable<V>>;

/**
 * Equality by default: `{ roomId }`. Use operators for the rest:
 * `{ sentAt: { $gte: from, $lt: to } }`, `{ roomId: { $in: ids } }`.
 */
export type Where<T> = { [K in EntityProperty<T>]?: WhereValue<T[K]> };

export type OrderDirection = 'ASC' | 'DESC';

/** Clustering columns to sort by; key order is the sort order. */
export type OrderBy<T> = { [K in EntityProperty<T>]?: OrderDirection };

export type RelationOperator = '=' | 'IN' | '>' | '>=' | '<' | '<=';

export interface Restriction {
  readonly column: ColumnMetadata;
  readonly operator: RelationOperator;
  readonly value: unknown;
}

const OPERATORS = new Map<string, RelationOperator>([
  ['$in', 'IN'],
  ['$gt', '>'],
  ['$gte', '>='],
  ['$lt', '<'],
  ['$lte', '<='],
]);

export function isRange(operator: RelationOperator): boolean {
  return operator !== '=' && operator !== 'IN';
}

/**
 * Turns a {@link Where} object into column restrictions. `undefined` is an
 * error rather than "match anything": silently dropping a key from a delete
 * is how tables get wiped.
 */
export function normalizeWhere(
  metadata: EntityMetadata,
  where: object,
  { allowNull = false } = {},
): Restriction[] {
  const restrictions: Restriction[] = [];

  for (const [property, raw] of Object.entries(where)) {
    const column = resolveColumn(metadata, property);
    if (raw === undefined) {
      throw new InvalidQueryError(
        `Value for "${property}" is undefined. Pass a value or remove the key.`,
      );
    }

    if (!isOperatorObject(raw)) {
      if (raw === null && !allowNull) {
        throw new InvalidQueryError(
          `"${property}" cannot be compared to null in a WHERE clause`,
        );
      }
      restrictions.push({ column, operator: '=', value: raw });
      continue;
    }

    const operators = Object.entries(raw);
    let lower = 0;
    let upper = 0;
    for (const [key, value] of operators) {
      // A Map, so keys like `toString` or `__proto__` never resolve.
      const operator = OPERATORS.get(key);
      if (!operator) {
        throw new InvalidQueryError(
          `Unknown operator "${key}" on "${property}". Supported: ${[...OPERATORS.keys()].join(', ')}`,
        );
      }
      if (value === undefined || value === null) {
        throw new InvalidQueryError(
          `Value for "${property}.${key}" must not be ${value}`,
        );
      }
      if (operator === 'IN' && !Array.isArray(value)) {
        throw new InvalidQueryError(`"${property}.$in" must be an array`);
      }
      if (operator === '>' || operator === '>=') lower++;
      if (operator === '<' || operator === '<=') upper++;
      restrictions.push({ column, operator, value });
    }

    if ('$in' in raw && operators.length > 1) {
      throw new InvalidQueryError(
        `"${property}" cannot combine $in with other operators`,
      );
    }
    if (lower > 1 || upper > 1) {
      throw new InvalidQueryError(
        `"${property}" can have at most one lower ($gt/$gte) and one upper ($lt/$lte) bound`,
      );
    }
  }

  return restrictions;
}

export function resolveColumn(
  metadata: EntityMetadata,
  property: string,
): ColumnMetadata {
  const column = metadata.findColumn(property);
  if (!column) {
    throw new InvalidQueryError(
      `${metadata.target.name} has no mapped property "${property}"`,
    );
  }
  return column;
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.some((key) => key.startsWith('$'));
}
