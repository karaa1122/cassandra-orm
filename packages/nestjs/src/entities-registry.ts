import type { EntityClass } from '@cassandra-orm/core';

/**
 * Entities collected from `forFeature()` calls. Those run while modules are
 * being declared, before any provider factory, so the DataSource factory can
 * read the complete list.
 */
const registry = new Map<string, Set<EntityClass>>();

export function registerEntities(
  connectionName: string,
  entities: EntityClass[],
): void {
  const set = registry.get(connectionName) ?? new Set();
  entities.forEach((entity) => set.add(entity));
  registry.set(connectionName, set);
}

export function getRegisteredEntities(connectionName: string): EntityClass[] {
  return [...(registry.get(connectionName) ?? [])];
}
