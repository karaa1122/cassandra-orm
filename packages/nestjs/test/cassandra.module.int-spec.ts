import {
  Column,
  DataSource,
  PartitionKey,
  Repository,
  Table,
} from '@cassandra-orm/core';
import { Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { types } from 'cassandra-driver';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cassandraConfig, resetKeyspace } from '../../../test/cassandra';
import {
  CassandraModule,
  getDataSourceToken,
  InjectDataSource,
  InjectRepository,
  type CassandraOptionsFactory,
} from '../src';

const KEYSPACE = 'nest_it';
const ANALYTICS_KEYSPACE = 'nest_it_analytics';

@Table('users')
class User {
  @PartitionKey({ type: 'uuid' })
  id!: string;

  @Column({ type: 'text' })
  email!: string;
}

@Table('page_hits')
class PageHits {
  @PartitionKey({ type: 'text' })
  page!: string;

  @Column({ type: 'counter' })
  hits!: types.Long;
}

@Injectable()
class UsersService {
  constructor(
    @InjectRepository(User) readonly users: Repository<User>,
    @InjectDataSource() readonly dataSource: DataSource,
  ) {}
}

@Module({
  imports: [CassandraModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService],
})
class UsersModule {}

@Injectable()
class AnalyticsService {
  constructor(
    @InjectRepository(PageHits, 'analytics')
    readonly hits: Repository<PageHits>,
  ) {}
}

@Module({
  imports: [CassandraModule.forFeature([PageHits], 'analytics')],
  providers: [AnalyticsService],
})
class AnalyticsModule {}

const baseOptions = () => ({
  ...cassandraConfig(),
  keyspace: KEYSPACE,
  synchronize: true,
  autoLoadEntities: true,
});

let moduleRef: TestingModule | undefined;

beforeAll(async () => {
  await resetKeyspace(KEYSPACE);
  await resetKeyspace(ANALYTICS_KEYSPACE);
});

afterEach(async () => {
  await moduleRef?.close();
  moduleRef = undefined;
});

describe('CassandraModule', () => {
  it('injects repositories and the data source (forRootAsync + useFactory)', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        CassandraModule.forRootAsync({ useFactory: baseOptions }),
        UsersModule,
      ],
    }).compile();
    await moduleRef.init();

    const service = moduleRef.get(UsersService);
    expect(service.users).toBeInstanceOf(Repository);
    expect(service.dataSource.isConnected).toBe(true);

    // autoLoadEntities + synchronize created the table from forFeature().
    const id = '6f1c2a3e-4b5d-4c6e-8f70-819203a4b5c6';
    await service.users.insert({ id, email: 'ada@example.com' });
    expect(await service.users.findOne({ id })).toMatchObject({
      email: 'ada@example.com',
    });
  });

  it('closes the connection on application shutdown', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [CassandraModule.forRoot(baseOptions()), UsersModule],
    }).compile();
    await moduleRef.init();
    const dataSource = moduleRef.get<DataSource>(getDataSourceToken());

    await moduleRef.close();
    moduleRef = undefined;

    expect(dataSource.isConnected).toBe(false);
  });

  it('supports useClass options factories', async () => {
    @Injectable()
    class ConfigFactory implements CassandraOptionsFactory {
      createCassandraOptions() {
        return baseOptions();
      }
    }

    moduleRef = await Test.createTestingModule({
      imports: [
        CassandraModule.forRootAsync({ useClass: ConfigFactory }),
        UsersModule,
      ],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(UsersService).dataSource.isConnected).toBe(true);
  });

  it('keeps named connections separate', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        CassandraModule.forRoot(baseOptions()),
        CassandraModule.forRoot({
          ...baseOptions(),
          name: 'analytics',
          keyspace: ANALYTICS_KEYSPACE,
        }),
        UsersModule,
        AnalyticsModule,
      ],
    }).compile();
    await moduleRef.init();

    const analytics = moduleRef.get(AnalyticsService);
    const users = moduleRef.get(UsersService);
    expect(analytics.hits.client).not.toBe(users.users.client);

    await analytics.hits.increment({ page: '/' }, { hits: 5 });
    expect((await analytics.hits.findOne({ page: '/' }))?.hits.toString()).toBe(
      '5',
    );
    expect(analytics.hits.client.keyspace).toBe(ANALYTICS_KEYSPACE);
  });
});
