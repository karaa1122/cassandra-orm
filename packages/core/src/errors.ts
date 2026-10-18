/** Base class for every error thrown by @cassandra-orm/core. */
export class CassandraOrmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** An entity class is missing decorators or is declared inconsistently. */
export class EntityMetadataError extends CassandraOrmError {}

/**
 * A query would be rejected by Cassandra (or silently scan the cluster), and
 * was stopped before reaching the database.
 */
export class InvalidQueryError extends CassandraOrmError {}
