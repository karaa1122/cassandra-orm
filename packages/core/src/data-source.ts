import { Client, type ClientOptions } from 'cassandra-driver';
import { CassandraOrmError } from './errors';
import type { EntityClass } from './metadata/entity-metadata';
import { getEntityMetadata } from './metadata/metadata-storage';
import { buildCreateTable } from './query/cql-builder';
import { Repository } from './repository';

interface BaseDataSourceOptions {
  /** Entities to create tables for when `synchronize` is on. */
  entities?: EntityClass[];
  /**
   * Runs `CREATE TABLE IF NOT EXISTS` for every entity on connect. It never
   * alters or drops anything, but is still meant for development only.
   */
  synchronize?: boolean;
}

export type DataSourceOptions =
  | (ClientOptions & BaseDataSourceOptions & { client?: never })
  | (BaseDataSourceOptions & {
      /** Reuse an existing client. The DataSource will not shut it down. */
      client: Client;
    });

export class DataSource {
  readonly client: Client;
  private readonly ownsClient: boolean;
  private readonly entities: EntityClass[];
  private readonly synchronizeOnConnect: boolean;
  private readonly repositories = new Map<EntityClass, Repository<any>>();
  private connected = false;

  constructor(options: DataSourceOptions) {
    const {
      entities = [],
      synchronize = false,
      client,
      ...clientOptions
    } = options;
    this.ownsClient = !client;
    this.client = client ?? new Client(clientOptions as ClientOptions);
    this.entities = [...entities];
    this.synchronizeOnConnect = synchronize;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<this> {
    if (this.connected) return this;
    await this.client.connect();
    this.connected = true;
    if (this.synchronizeOnConnect) {
      await this.synchronize();
    }
    return this;
  }

  /** Shuts the client down, unless it was passed in by the caller. */
  async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    if (this.ownsClient) {
      await this.client.shutdown();
    }
  }

  /** Registers more entities, e.g. ones discovered after construction. */
  addEntities(entities: EntityClass[]): void {
    for (const entity of entities) {
      if (!this.entities.includes(entity)) this.entities.push(entity);
    }
  }

  getRepository<T extends object>(target: EntityClass<T>): Repository<T> {
    let repository = this.repositories.get(target);
    if (!repository) {
      repository = new Repository<T>(this.client, getEntityMetadata(target));
      this.repositories.set(target, repository);
    }
    return repository;
  }

  /** Creates missing tables for the registered entities. */
  async synchronize(): Promise<void> {
    if (!this.connected) {
      throw new CassandraOrmError('Call connect() before synchronize()');
    }
    // Sequential on purpose: concurrent DDL can leave the schema in disagreement.
    for (const entity of this.entities) {
      await this.client.execute(buildCreateTable(getEntityMetadata(entity)));
    }
  }
}
