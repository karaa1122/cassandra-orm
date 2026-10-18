import { EntityMetadataError } from '../errors';
import type { EntityClass, RelationKind } from '../metadata/entity-metadata';
import { getMetadataStorage } from '../metadata/metadata-storage';
import type { EntityProperty } from '../query/where';
import { assertLegacyDecorator } from './table.decorator';

export interface RelationOptions<TTarget> {
  /**
   * How to find related rows: this entity's property -> the target's
   * property. The target properties must form a queryable key (at least the
   * full partition key), because Cassandra cannot join.
   */
  on: Record<string, EntityProperty<TTarget>>;
}

/**
 * At most one related row, e.g. a message's author:
 * `@BelongsTo(() => User, { on: { authorId: 'id' } }) author?: User | null;`
 *
 * Loaded on demand with `find(..., { include: ['author'] })`, using one
 * extra query per distinct key (like Django's `prefetch_related`).
 */
export function BelongsTo<TTarget>(
  target: () => EntityClass<TTarget>,
  options: RelationOptions<TTarget>,
): PropertyDecorator {
  return relationDecorator('@BelongsTo()', 'belongsTo', target, options);
}

/**
 * A list of related rows, e.g. a user's posts stored in a table partitioned
 * by user id:
 * `@HasMany(() => Post, { on: { id: 'userId' } }) posts?: Post[];`
 */
export function HasMany<TTarget>(
  target: () => EntityClass<TTarget>,
  options: RelationOptions<TTarget>,
): PropertyDecorator {
  return relationDecorator('@HasMany()', 'hasMany', target, options);
}

function relationDecorator<TTarget>(
  decorator: string,
  kind: RelationKind,
  target: () => EntityClass<TTarget>,
  options: RelationOptions<TTarget>,
): PropertyDecorator {
  return (prototype, propertyKey) => {
    assertLegacyDecorator(propertyKey, decorator);
    if (typeof propertyKey !== 'string') {
      throw new EntityMetadataError(
        `${decorator} cannot be used on symbol properties`,
      );
    }
    if (typeof target !== 'function' || !options?.on) {
      throw new EntityMetadataError(
        `${decorator} on ${prototype.constructor.name}.${propertyKey} needs a target thunk and an "on" mapping`,
      );
    }
    getMetadataStorage().addRelation(prototype.constructor, {
      propertyName: propertyKey,
      kind,
      target,
      on: { ...options.on },
    });
  };
}
