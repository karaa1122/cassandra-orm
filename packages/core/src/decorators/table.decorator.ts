import { EntityMetadataError } from '../errors';
import { getMetadataStorage } from '../metadata/metadata-storage';
import { toSnakeCase } from '../metadata/naming';

export interface TableOptions {
  /** Table name. Defaults to the class name in snake_case. */
  name?: string;
  /** Keyspace to qualify queries with. Defaults to the client's keyspace. */
  keyspace?: string;
}

/** Marks a class as an entity mapped to a Cassandra table. */
export function Table(nameOrOptions?: string | TableOptions): ClassDecorator {
  const options =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;

  return (target, context?: unknown) => {
    assertLegacyDecorator(context, '@Table()');
    getMetadataStorage().addTable(target, {
      table: options?.name ?? toSnakeCase(target.name),
      keyspace: options?.keyspace,
    });
  };
}

/**
 * The 2022 "standard" decorators pass a context object as the second argument.
 * Fail loudly instead of silently registering nothing.
 */
export function assertLegacyDecorator(context: unknown, decorator: string) {
  if (typeof context === 'object' && context !== null && 'kind' in context) {
    throw new EntityMetadataError(
      `${decorator} requires "experimentalDecorators": true in your tsconfig.json`,
    );
  }
}
