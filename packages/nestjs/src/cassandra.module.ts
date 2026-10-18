import type { DataSource, EntityClass } from '@cassandra-orm/core';
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { DEFAULT_CONNECTION_NAME } from './cassandra.constants';
import { CassandraCoreModule } from './cassandra-core.module';
import { getDataSourceToken, getRepositoryToken } from './cassandra.utils';
import type {
  CassandraModuleAsyncOptions,
  CassandraModuleOptions,
} from './cassandra-module-options.interface';
import { registerEntities } from './entities-registry';

@Module({})
export class CassandraModule {
  /**
   * Opens a connection and makes its `DataSource` injectable app-wide.
   * Give it a `name` to configure additional clusters.
   */
  static forRoot(options: CassandraModuleOptions): DynamicModule {
    return {
      module: CassandraModule,
      imports: [CassandraCoreModule.forRoot(options)],
    };
  }

  static forRootAsync(options: CassandraModuleAsyncOptions): DynamicModule {
    return {
      module: CassandraModule,
      imports: [CassandraCoreModule.forRootAsync(options)],
    };
  }

  /** Provides a `Repository` per entity, injectable with `@InjectRepository()`. */
  static forFeature(
    entities: EntityClass[],
    connectionName: string = DEFAULT_CONNECTION_NAME,
  ): DynamicModule {
    registerEntities(connectionName, entities);
    const providers: Provider[] = entities.map((entity) => ({
      provide: getRepositoryToken(entity, connectionName),
      useFactory: (dataSource: DataSource) => dataSource.getRepository(entity),
      inject: [getDataSourceToken(connectionName)],
    }));
    return { module: CassandraModule, providers, exports: providers };
  }
}
