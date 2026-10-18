import type { CqlType } from '../cql-types';
import { EntityMetadataError } from '../errors';
import type { ClusteringOrder, ColumnKind } from '../metadata/entity-metadata';
import { getMetadataStorage } from '../metadata/metadata-storage';
import { toSnakeCase } from '../metadata/naming';
import { assertLegacyDecorator } from './table.decorator';

export interface ColumnOptions {
  /**
   * CQL type of the column. Required: TypeScript's `string` cannot tell
   * `text` from `uuid`, `timeuuid` or `ascii`.
   */
  type: CqlType;
  /** Column name. Defaults to the property name in snake_case. */
  name?: string;
}

export interface RegularColumnOptions extends ColumnOptions {
  /** Shared by every row of a partition. */
  static?: boolean;
}

export interface ClusteringKeyOptions extends ColumnOptions {
  /** On-disk sort order within the partition. Defaults to `ASC`. */
  order?: ClusteringOrder;
}

/**
 * Part of the partition key. Declare several for a composite partition key;
 * their declaration order is the key order.
 */
export function PartitionKey(options: ColumnOptions): PropertyDecorator {
  return columnDecorator('@PartitionKey()', 'partition', options);
}

/** Clustering column, in declaration order. */
export function ClusteringKey(
  options: ClusteringKeyOptions,
): PropertyDecorator {
  return columnDecorator('@ClusteringKey()', 'clustering', options, {
    order: options.order ?? 'ASC',
  });
}

/** Regular (or static) column. */
export function Column(options: RegularColumnOptions): PropertyDecorator {
  return columnDecorator(
    '@Column()',
    options.static ? 'static' : 'regular',
    options,
  );
}

function columnDecorator(
  decorator: string,
  kind: ColumnKind,
  options: ColumnOptions,
  extra: { order?: ClusteringOrder } = {},
): PropertyDecorator {
  return (target, propertyKey) => {
    assertLegacyDecorator(propertyKey, decorator);
    if (typeof propertyKey !== 'string') {
      throw new EntityMetadataError(
        `${decorator} cannot be used on symbol properties`,
      );
    }
    if (!options?.type) {
      throw new EntityMetadataError(
        `${decorator} on ${target.constructor.name}.${propertyKey} needs a CQL type, e.g. { type: 'text' }`,
      );
    }
    getMetadataStorage().addColumn(target.constructor, {
      propertyName: propertyKey,
      name: options.name ?? toSnakeCase(propertyKey),
      type: options.type,
      kind,
      ...extra,
    });
  };
}
