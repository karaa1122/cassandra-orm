import { InvalidQueryError } from '../errors';
import type {
  EntityClass,
  EntityMetadata,
  RelationMetadata,
} from '../metadata/entity-metadata';
import type { Repository } from '../repository';
import { normalizeInclude, type Include, type IncludeOptions } from './include';

/** Upper bound on related-row queries in flight per relation. */
const MAX_CONCURRENT_QUERIES = 32;

type RepositoryFor = (target: EntityClass) => Repository<any>;

/**
 * Loads relations the way Cassandra allows: no joins, one query per distinct
 * key, run concurrently, then stitched onto the parents in memory. This is
 * Django's `prefetch_related`; `select_related` needs a SQL JOIN and has no
 * Cassandra equivalent.
 */
export async function loadRelations(
  metadata: EntityMetadata,
  parents: object[],
  include: Include<any>,
  repositoryFor: RepositoryFor,
): Promise<void> {
  if (parents.length === 0) return;

  for (const [name, options] of normalizeInclude(include)) {
    const relation = metadata.findRelation(name);
    if (!relation) {
      throw new InvalidQueryError(
        `${metadata.target.name} has no relation "${name}". Declare it with @BelongsTo() or @HasMany().`,
      );
    }
    await loadRelation(metadata, relation, parents, options, repositoryFor);
  }
}

async function loadRelation(
  metadata: EntityMetadata,
  relation: RelationMetadata,
  parents: object[],
  options: IncludeOptions<any>,
  repositoryFor: RepositoryFor,
): Promise<void> {
  const repository = repositoryFor(relation.target());
  const pairs = Object.entries(relation.on);
  const empty = () => (relation.kind === 'hasMany' ? [] : null);

  if (relation.kind === 'belongsTo' && (options.limit || options.orderBy)) {
    throw new InvalidQueryError(
      `${metadata.target.name}.${relation.propertyName} is a @BelongsTo relation; limit and orderBy only apply to @HasMany`,
    );
  }

  // Parents sharing a key share one query.
  const groups = new Map<
    string,
    { where: Record<string, unknown>; parents: Record<string, unknown>[] }
  >();
  for (const parent of parents as Record<string, unknown>[]) {
    const values = pairs.map(([source]) => parent[source]);
    if (values.some((value) => value === null || value === undefined)) {
      parent[relation.propertyName] = empty();
      continue;
    }
    const key = groupKey(values);
    let group = groups.get(key);
    if (!group) {
      group = {
        where: Object.fromEntries(
          pairs.map(([, target], index) => [target, values[index]]),
        ),
        parents: [],
      };
      groups.set(key, group);
    }
    group.parents.push(parent);
  }

  try {
    await forEachConcurrent(
      [...groups.values()],
      MAX_CONCURRENT_QUERIES,
      async (group) => {
        if (relation.kind === 'hasMany') {
          const related = await repository.find(group.where, {
            limit: options.limit,
            orderBy: options.orderBy,
            include: options.include,
          });
          for (const parent of group.parents) {
            parent[relation.propertyName] = [...related];
          }
        } else {
          const related = await repository.findOne(group.where, {
            include: options.include,
          });
          for (const parent of group.parents) {
            parent[relation.propertyName] = related;
          }
        }
      },
    );
  } catch (error) {
    if (error instanceof InvalidQueryError) {
      throw new InvalidQueryError(
        `Cannot load relation ${metadata.target.name}.${relation.propertyName}: ${error.message}`,
      );
    }
    throw error;
  }
}

function groupKey(values: unknown[]): string {
  return JSON.stringify(
    values.map((value) => {
      if (value instanceof Date) return value.getTime();
      if (Buffer.isBuffer(value)) return value.toString('hex');
      if (typeof value === 'bigint' || typeof value === 'object') {
        return String(value);
      }
      return value;
    }),
  );
}

async function forEachConcurrent<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}
