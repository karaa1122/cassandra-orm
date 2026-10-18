# @cassandra-orm/nestjs

NestJS integration for [`@cassandra-orm/core`](https://www.npmjs.com/package/@cassandra-orm/core).

> **Early release (0.x):** well tested, but not yet used in production, and the API may change in minor versions. Pin exact versions. See the [project status](https://github.com/karaa1122/cassandra-orm#readme).

```bash
npm install @cassandra-orm/nestjs @cassandra-orm/core cassandra-driver
```

```ts
import { CassandraModule, InjectRepository } from '@cassandra-orm/nestjs';
import { Repository } from '@cassandra-orm/core';

@Module({
  imports: [
    CassandraModule.forRoot({
      contactPoints: ['127.0.0.1:9042'],
      localDataCenter: 'datacenter1',
      keyspace: 'chat',
      autoLoadEntities: true, // register entities from forFeature()
    }),
    CassandraModule.forFeature([Message]),
  ],
  providers: [ChatService],
})
export class ChatModule {}

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message) private readonly messages: Repository<Message>,
  ) {}
}
```

- `forRoot(options)` / `forRootAsync({ useFactory | useClass | useExisting, inject, imports })`
- `forFeature(entities, connectionName?)` provides one `Repository` per entity
- `@InjectRepository(Entity, connectionName?)`, `@InjectDataSource(connectionName?)`
- `getRepositoryToken()` / `getDataSourceToken()` for custom providers and test overrides
- Named connections: `forRoot({ ..., name: 'analytics' })`
- The driver is shut down on application shutdown (`app.enableShutdownHooks()` for signals)

Works with NestJS 11 and 12, in CommonJS and ESM apps.

Full documentation: https://github.com/karaa1122/cassandra-orm#readme

License: Apache-2.0
