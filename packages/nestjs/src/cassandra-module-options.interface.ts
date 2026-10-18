import type { DataSourceOptions } from '@cassandra-orm/core';
import type { ModuleMetadata, Type } from '@nestjs/common';

export type CassandraModuleOptions = DataSourceOptions & {
  /** Connection name, for apps that talk to more than one cluster. */
  name?: string;
  /**
   * Also register every entity passed to `CassandraModule.forFeature()`
   * for this connection, so `synchronize` creates their tables too.
   */
  autoLoadEntities?: boolean;
};

export interface CassandraOptionsFactory {
  createCassandraOptions(
    connectionName?: string,
  ): CassandraModuleOptions | Promise<CassandraModuleOptions>;
}

export interface CassandraModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  /** Connection name, for apps that talk to more than one cluster. */
  name?: string;
  useFactory?: (
    ...args: any[]
  ) => CassandraModuleOptions | Promise<CassandraModuleOptions>;
  inject?: any[];
  useClass?: Type<CassandraOptionsFactory>;
  useExisting?: Type<CassandraOptionsFactory>;
}
