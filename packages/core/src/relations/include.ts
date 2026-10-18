import type { EntityProperty, OrderBy } from '../query/where';

/** Element type for list relations, the type itself otherwise. */
export type RelatedEntity<V> =
  NonNullable<V> extends ReadonlyArray<infer E> ? E : NonNullable<V>;

export interface IncludeOptions<R> {
  /** Maximum related rows per parent (`HasMany` only). */
  limit?: number;
  orderBy?: OrderBy<R>;
  /** Relations of the related entity to load as well. */
  include?: Include<R>;
}

/**
 * Relations to load alongside the result: `['author']`, or with options,
 * `{ posts: { limit: 5, include: ['comments'] } }`.
 */
export type Include<T> =
  | ReadonlyArray<EntityProperty<T>>
  | {
      readonly [K in EntityProperty<T>]?:
        true | IncludeOptions<RelatedEntity<T[K]>>;
    };

export function normalizeInclude(
  include: Include<any>,
): Array<[string, IncludeOptions<any>]> {
  if (Array.isArray(include)) {
    return include.map((name) => [name, {}]);
  }
  return Object.entries(include as Record<string, true | IncludeOptions<any>>)
    .filter(([, options]) => Boolean(options))
    .map(([name, options]) => [name, options === true ? {} : options]);
}
