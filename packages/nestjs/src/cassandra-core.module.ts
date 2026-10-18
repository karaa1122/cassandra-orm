import { DataSource, type DataSourceOptions } from '@cassandra-orm/core';
import {
  Global,
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  CASSANDRA_CONNECTION_NAME,
  CASSANDRA_MODULE_OPTIONS,
  DEFAULT_CONNECTION_NAME,
} from './cassandra.constants';
import { getDataSourceToken } from './cassandra.utils';
import type {
  CassandraModuleAsyncOptions,
  CassandraModuleOptions,
  CassandraOptionsFactory,
} from './cassandra-module-options.interface';
import { getRegisteredEntities } from './entities-registry';

@Global()
@Module({})
export class CassandraCoreModule implements OnApplicationShutdown {
  // Explicit @Inject() so the module works without emitDecoratorMetadata.
  constructor(
    @Inject(CASSANDRA_CONNECTION_NAME) private readonly connectionName: string,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  static forRoot(options: CassandraModuleOptions): DynamicModule {
    return this.createModule(options.name ?? DEFAULT_CONNECTION_NAME, [
      { provide: CASSANDRA_MODULE_OPTIONS, useValue: options },
    ]);
  }

  static forRootAsync(options: CassandraModuleAsyncOptions): DynamicModule {
    const connectionName = options.name ?? DEFAULT_CONNECTION_NAME;
    return this.createModule(
      connectionName,
      this.createAsyncProviders(options, connectionName),
      options.imports,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    const dataSource = this.moduleRef.get<DataSource>(
      getDataSourceToken(this.connectionName),
    );
    await dataSource.close();
  }

  private static createModule(
    connectionName: string,
    optionsProviders: Provider[],
    imports: DynamicModule['imports'] = [],
  ): DynamicModule {
    const dataSourceProvider: Provider = {
      provide: getDataSourceToken(connectionName),
      useFactory: async (options: CassandraModuleOptions) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { name, autoLoadEntities, ...dataSourceOptions } = options;
        const dataSource = new DataSource(
          dataSourceOptions as DataSourceOptions,
        );
        if (autoLoadEntities) {
          dataSource.addEntities(getRegisteredEntities(connectionName));
        }
        return dataSource.connect();
      },
      inject: [CASSANDRA_MODULE_OPTIONS],
    };

    return {
      module: CassandraCoreModule,
      imports,
      providers: [
        { provide: CASSANDRA_CONNECTION_NAME, useValue: connectionName },
        ...optionsProviders,
        dataSourceProvider,
      ],
      exports: [dataSourceProvider],
    };
  }

  private static createAsyncProviders(
    options: CassandraModuleAsyncOptions,
    connectionName: string,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: CASSANDRA_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    const factoryClass = options.useClass ?? options.useExisting;
    if (!factoryClass) {
      throw new Error(
        'CassandraModule.forRootAsync() needs useFactory, useClass or useExisting',
      );
    }
    const providers: Provider[] = [
      {
        provide: CASSANDRA_MODULE_OPTIONS,
        useFactory: (factory: CassandraOptionsFactory) =>
          factory.createCassandraOptions(connectionName),
        inject: [factoryClass],
      },
    ];
    if (options.useClass) {
      providers.push({ provide: options.useClass, useClass: options.useClass });
    }
    return providers;
  }
}
