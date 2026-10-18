# cassandra-orm

A TypeScript-first object mapper for Apache Cassandra, built on the official [`cassandra-driver`](https://github.com/apache/cassandra-nodejs-driver). The core works with any framework; NestJS integration ships as a separate package.

[![CI](https://github.com/karaa1122/cassandra-orm/actions/workflows/ci.yml/badge.svg)](https://github.com/karaa1122/cassandra-orm/actions/workflows/ci.yml)

| Package                                    | Use it for                                                     |
| ------------------------------------------ | -------------------------------------------------------------- |
| [`@cassandra-orm/core`](packages/core)     | Entities, repositories, queries. Express, Fastify, plain Node… |
| [`@cassandra-orm/nestjs`](packages/nestjs) | `CassandraModule`, `@InjectRepository()` for NestJS 11 and 12  |

## Why another Cassandra ORM?

Cassandra is not a relational database, and pretending it is leads to slow, broken queries. This library is designed around how Cassandra actually works:

- **Primary-key aware queries.** Every query is checked against the table's partition and clustering keys _before_ it reaches the cluster. Queries that would need `ALLOW FILTERING` (a scan) fail with an explanation, unless you opt in.
- **No tombstones by accident.** Missing values are bound as `unset`, not `null`, so a partial insert never wipes or tombstones existing columns.
- **Injection-proof by construction.** Values are always bound parameters in prepared statements; identifiers come only from your entity metadata and are quoted. See [SECURITY.md](SECURITY.md).
- **Relations without joins.** `@BelongsTo` / `@HasMany` load related rows with key lookups (like Django's `prefetch_related`), validated like any other query.
- **The Cassandra features you actually use:** cursor pagination, lightweight transactions, TTL, write timestamps, counters, static columns, consistency levels.

## Install

Requires Node.js 22+ and Cassandra 4.1 or 5.0.

```bash
npm install @cassandra-orm/core cassandra-driver
# NestJS apps also:
npm install @cassandra-orm/nestjs
```

Enable legacy decorators in `tsconfig.json` (NestJS projects already have this):

```json
{ "compilerOptions": { "experimentalDecorators": true } }
```

## Define entities

```ts
import {
  ClusteringKey,
  Column,
  PartitionKey,
  Table,
} from '@cassandra-orm/core';

@Table('messages_by_room')
export class Message {
  @PartitionKey({ type: 'uuid' })
  roomId!: string;

  @ClusteringKey({ type: 'timeuuid', order: 'DESC' })
  messageId!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'set<text>' })
  tags?: string[] | null;
}
```

CQL types are always explicit, because TypeScript's `string` cannot tell `text` from `uuid` or `timeuuid`. Column names default to the property name in snake_case (`roomId` → `room_id`); override with `name`.

## Use it anywhere (plain Node, Express, Fastify…)

```ts
import { DataSource } from '@cassandra-orm/core';

const dataSource = new DataSource({
  contactPoints: ['127.0.0.1:9042'],
  localDataCenter: 'datacenter1',
  keyspace: 'chat',
  entities: [Message],
  synchronize: true, // CREATE TABLE IF NOT EXISTS. Development only.
});
await dataSource.connect();

const messages = dataSource.getRepository(Message);
await messages.insert({ roomId, messageId, body: 'hi' }, { ttl: 3600 });
const latest = await messages.find({ roomId }, { limit: 50 });
```

Already have a `Client`? Pass `{ client, entities }` instead; the DataSource will not shut it down.

## Use it in NestJS

```ts
import { CassandraModule, InjectRepository } from '@cassandra-orm/nestjs';
import { Repository } from '@cassandra-orm/core';

@Module({
  imports: [
    CassandraModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        contactPoints: config.get('CASSANDRA_CONTACT_POINTS').split(','),
        localDataCenter: config.get('CASSANDRA_DC'),
        keyspace: 'chat',
        autoLoadEntities: true,
      }),
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

The connection closes on application shutdown. Multiple clusters: give `forRoot` a `name` and pass it to `forFeature([...], name)` and `@InjectRepository(Entity, name)`. A runnable app lives in [`examples/nestjs-app`](examples/nestjs-app).

## Querying

```ts
// Equality by default; operators for the rest.
await messages.find({ roomId, messageId: { $gt: since } });
await messages.find({ roomId: { $in: [a, b] } });

// Sort by clustering columns (their declared order or its exact reverse).
await messages.find({ roomId }, { orderBy: { messageId: 'ASC' }, limit: 10 });

// Stream big partitions without loading them into memory.
for await (const message of messages.iterate({ roomId })) {
  /* … */
}

// Cursor pagination for APIs (Cassandra has no OFFSET).
const page = await messages.findPage({ roomId }, { pageSize: 20, pageState });
// -> { items, pageState: string | null }
```

Queries that Cassandra could only answer by scanning are rejected:

```ts
await messages.find({ body: 'hi' });
// InvalidQueryError: Query on Message would require ALLOW FILTERING:
// "body" is not part of the primary key. Query by the primary key, or pass
// allowFiltering: true if scanning is acceptable.
```

`undefined` in a `where` object is an error, never "match anything". That way a missing request parameter can't turn `delete({ roomId })` into something broader.

## Writing

```ts
await messages.insert(message); // upsert, like all CQL INSERTs
await messages.insert(message, { ifNotExists: true }); // -> { applied: boolean }
await messages.update({ roomId, messageId }, { body: 'edited' });
await messages.update(key, { body: 'v2' }, { if: { body: 'v1' } }); // LWT
await messages.update(key, { tags: null }); // null deletes the cell
await messages.delete({ roomId }); // whole partition
await messages.delete({ roomId, messageId: { $lt: cutoff } }); // clustering range
await pageViews.increment({ page: '/' }, { views: 1 }); // counter tables
```

All write methods accept `ttl` (insert/update), `timestamp` (µs), `consistency`, `serialConsistency`, `executionProfile` and `isIdempotent`.

## Relations (no joins)

Cassandra cannot join tables. Django's `select_related` relies on SQL JOINs, so it has no equivalent here. Django's `prefetch_related` does: a second query per distinct key, stitched together in memory. That is what relations do:

```ts
@Table('users')
class User {
  @PartitionKey({ type: 'uuid' }) id!: string;
  @Column({ type: 'text' }) name!: string;

  @HasMany(() => Post, { on: { id: 'authorId' } })
  posts?: Post[];
}

@Table('posts_by_author') // partitioned by author: "posts of a user" is one partition
class Post {
  @PartitionKey({ type: 'uuid' }) authorId!: string;
  @ClusteringKey({ type: 'timeuuid', order: 'DESC' }) postId!: string;
  @Column({ type: 'text' }) title!: string;

  @BelongsTo(() => User, { on: { authorId: 'id' } })
  author?: User | null;
}

const user = await users.findOne(
  { id },
  { include: { posts: { limit: 5, include: ['author'] } } },
);
```

- One query per _distinct_ key (32 in flight at most), never one per row.
- The target side of `on` must be a queryable key, at least the full partition key. A relation that would need a scan throws, which tells you to model a table for that access pattern.
- Relations are read-only and only loaded when you `include` them; `insert()` ignores them.

## Type mapping

| CQL                                             | TypeScript                                                  |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `uuid`, `timeuuid`                              | `string` (also inside collections)                          |
| `text`, `varchar`, `ascii`                      | `string`                                                    |
| `int`, `smallint`, `tinyint`, `float`, `double` | `number`                                                    |
| `bigint`, `counter`                             | driver `Long` (or `bigint` with `encoding.useBigIntAsLong`) |
| `timestamp`                                     | `Date`                                                      |
| `boolean`                                       | `boolean`                                                   |
| `list<T>`, `set<T>`                             | `T[]` (a `Set` with `encoding.set: Set`)                    |
| `map<K, V>`                                     | plain object (a `Map` with `encoding.map: Map`)             |
| everything else                                 | the driver's type (`BigDecimal`, `LocalDate`, …)            |

## Schema

`synchronize: true` runs `CREATE TABLE IF NOT EXISTS` for every entity on connect. It never alters or drops anything, and is meant for development and tests. `buildCreateTable(getEntityMetadata(Entity))` returns the CQL if you want to put it in your own migrations.

## Roadmap

- Migrations CLI
- User-defined types (UDTs) and tuples as first-class column types
- Secondary indexes / SAI declarations (lifting the filtering check for indexed columns)
- Batches (logged and unlogged) and multi-table denormalized writes
- Lifecycle hooks, a `@nestjs/terminus` health indicator
- ScyllaDB in the CI matrix
- A decorator-free `defineEntity()` API

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)
