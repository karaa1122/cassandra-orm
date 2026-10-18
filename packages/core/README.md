# @cassandra-orm/core

TypeScript-first object mapper for Apache Cassandra, built on [`cassandra-driver`](https://www.npmjs.com/package/cassandra-driver). It works with any framework. NestJS users should also install [`@cassandra-orm/nestjs`](https://www.npmjs.com/package/@cassandra-orm/nestjs).

```bash
npm install @cassandra-orm/core cassandra-driver
```

Requires `"experimentalDecorators": true` in `tsconfig.json`.

```ts
import {
  ClusteringKey,
  Column,
  DataSource,
  PartitionKey,
  Table,
} from '@cassandra-orm/core';

@Table('messages_by_room')
class Message {
  @PartitionKey({ type: 'uuid' }) roomId!: string;
  @ClusteringKey({ type: 'timeuuid', order: 'DESC' }) messageId!: string;
  @Column({ type: 'text' }) body!: string;
}

const dataSource = await new DataSource({
  contactPoints: ['127.0.0.1:9042'],
  localDataCenter: 'datacenter1',
  keyspace: 'chat',
  entities: [Message],
}).connect();

const messages = dataSource.getRepository(Message);
await messages.insert({ roomId, messageId, body: 'hi' });
const page = await messages.findPage({ roomId }, { pageSize: 20 });
```

Highlights: queries are checked against the primary key before they reach the cluster; missing values are bound as `unset` (no accidental tombstones); every value is a bound parameter; and relations (`@BelongsTo` / `@HasMany`) load through key lookups instead of joins.

Full documentation: https://github.com/karaa1122/cassandra-orm#readme

License: Apache-2.0
