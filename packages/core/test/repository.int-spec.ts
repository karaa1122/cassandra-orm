import { types } from 'cassandra-driver';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cassandraConfig, resetKeyspace } from '../../../test/cassandra';
import { DataSource, type Repository } from '../src';
import {
  Comment,
  Message,
  PageViews,
  Post,
  SensorReading,
  User,
} from './fixtures/entities';

const KEYSPACE = 'core_it';

let dataSource: DataSource;
let messages: Repository<Message>;
let readings: Repository<SensorReading>;
let pageViews: Repository<PageViews>;

beforeAll(async () => {
  await resetKeyspace(KEYSPACE);
  dataSource = new DataSource({
    ...cassandraConfig(),
    keyspace: KEYSPACE,
    entities: [Message, SensorReading, PageViews, User, Post, Comment],
    synchronize: true,
  });
  await dataSource.connect();
  messages = dataSource.getRepository(Message);
  readings = dataSource.getRepository(SensorReading);
  pageViews = dataSource.getRepository(PageViews);
});

afterAll(async () => {
  await dataSource?.close();
});

const newRoom = () => types.Uuid.random().toString();
const newMessageId = () => types.TimeUuid.now().toString();

async function seedRoom(count: number) {
  const roomId = newRoom();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const messageId = newMessageId();
    ids.push(messageId);
    await messages.insert({ roomId, messageId, body: `message ${i}` });
  }
  return { roomId, ids };
}

describe('Repository against Cassandra', () => {
  it('round-trips an entity', async () => {
    const roomId = newRoom();
    const messageId = newMessageId();
    await messages.insert({
      roomId,
      messageId,
      body: 'hello',
      tags: ['a', 'b'],
      roomName: 'general',
    });

    const found = await messages.findOne({ roomId, messageId });

    expect(found).toBeInstanceOf(Message);
    expect(found).toMatchObject({
      roomId,
      messageId,
      body: 'hello',
      tags: ['a', 'b'],
      roomName: 'general',
    });
  });

  it('returns null when nothing matches', async () => {
    expect(await messages.findOne({ roomId: newRoom() })).toBeNull();
  });

  it('does not overwrite columns left undefined (binds unset, not null)', async () => {
    const roomId = newRoom();
    const messageId = newMessageId();
    await messages.insert({ roomId, messageId, body: 'first', tags: ['keep'] });
    await messages.insert({ roomId, messageId, body: 'second' });

    const found = await messages.findOne({ roomId, messageId });
    expect(found).toMatchObject({ body: 'second', tags: ['keep'] });
  });

  it('shares static columns across a partition', async () => {
    const roomId = newRoom();
    await messages.insert({
      roomId,
      messageId: newMessageId(),
      body: 'a',
      roomName: 'lobby',
    });
    await messages.insert({ roomId, messageId: newMessageId(), body: 'b' });

    const rows = await messages.find({ roomId });
    expect(rows.map((m) => m.roomName)).toEqual(['lobby', 'lobby']);
  });

  it('honours clustering order and orderBy', async () => {
    const { roomId, ids } = await seedRoom(3);

    const newestFirst = await messages.find({ roomId });
    expect(newestFirst.map((m) => m.messageId)).toEqual([...ids].reverse());

    const oldestFirst = await messages.find(
      { roomId },
      { orderBy: { messageId: 'ASC' }, limit: 2 },
    );
    expect(oldestFirst.map((m) => m.messageId)).toEqual(ids.slice(0, 2));
  });

  it('pages with pageState cursors', async () => {
    const { roomId } = await seedRoom(25);

    const sizes: number[] = [];
    let pageState: string | null = null;
    do {
      const page = await messages.findPage(
        { roomId },
        { pageSize: 10, pageState },
      );
      sizes.push(page.items.length);
      pageState = page.pageState;
    } while (pageState);

    expect(sizes).toEqual([10, 10, 5]);
  });

  it('iterates across pages lazily', async () => {
    const { roomId } = await seedRoom(12);

    let count = 0;
    for await (const message of messages.iterate(
      { roomId },
      { fetchSize: 5 },
    )) {
      expect(message).toBeInstanceOf(Message);
      count++;
    }
    expect(count).toBe(12);
  });

  it('supports $in on the partition key', async () => {
    const a = await seedRoom(2);
    const b = await seedRoom(3);

    const rows = await messages.find({ roomId: { $in: [a.roomId, b.roomId] } });
    expect(rows).toHaveLength(5);
  });

  it('updates columns and deletes cells set to null', async () => {
    const roomId = newRoom();
    const messageId = newMessageId();
    await messages.insert({ roomId, messageId, body: 'draft', tags: ['x'] });

    await messages.update({ roomId, messageId }, { body: 'final', tags: null });

    expect(await messages.findOne({ roomId, messageId })).toMatchObject({
      body: 'final',
      tags: null,
    });
  });

  it('reports lightweight transaction outcomes', async () => {
    const roomId = newRoom();
    const messageId = newMessageId();
    const key = { roomId, messageId };

    expect(
      await messages.insert({ ...key, body: 'v1' }, { ifNotExists: true }),
    ).toEqual({ applied: true });
    expect(
      await messages.insert({ ...key, body: 'v2' }, { ifNotExists: true }),
    ).toEqual({ applied: false });

    expect(
      await messages.update(key, { body: 'v3' }, { if: { body: 'nope' } }),
    ).toEqual({ applied: false });
    expect(
      await messages.update(key, { body: 'v3' }, { if: { body: 'v1' } }),
    ).toEqual({ applied: true });

    expect((await messages.findOne(key))?.body).toBe('v3');
  });

  it('writes TTLs', async () => {
    const roomId = newRoom();
    const messageId = newMessageId();
    await messages.insert({ roomId, messageId, body: 'brb' }, { ttl: 300 });

    const result = await dataSource.client.execute(
      'SELECT TTL(body) AS ttl FROM messages_by_room WHERE room_id = ? AND message_id = ?',
      [roomId, messageId],
      { prepare: true },
    );
    expect(result.first().get('ttl')).toBeGreaterThan(290);
  });

  it('deletes a clustering range', async () => {
    const sensorId = 's-1';
    const bucket = '2026-10-18';
    for (let seq = 0; seq < 4; seq++) {
      await readings.insert({
        sensorId,
        bucket,
        recordedAt: new Date(Date.UTC(2026, 9, 18, seq)),
        seq,
        value: seq * 1.5,
      });
    }

    await readings.delete({
      sensorId,
      bucket,
      recordedAt: { $lt: new Date(Date.UTC(2026, 9, 18, 2)) },
    });

    const left = await readings.find({ sensorId, bucket });
    expect(left.map((r) => r.seq)).toEqual([2, 3]);
    expect(left[0].recordedAt).toBeInstanceOf(Date);
  });

  it('runs filtering queries only when allowed', async () => {
    const roomId = newRoom();
    await messages.insert({
      roomId,
      messageId: newMessageId(),
      body: 'needle',
    });

    await expect(messages.find({ body: 'needle' })).rejects.toThrow(
      /ALLOW FILTERING/,
    );
    const found = await messages.find(
      { roomId, body: 'needle' },
      { allowFiltering: true },
    );
    expect(found).toHaveLength(1);
  });

  it('increments counters', async () => {
    await pageViews.increment({ page: '/home' }, { views: 2 });
    await pageViews.increment({ page: '/home' }, { views: 1 });

    const row = await pageViews.findOne({ page: '/home' });
    expect(row?.views.toString()).toBe('3');
  });
});

describe('relations against Cassandra', () => {
  it('loads nested relations with key lookups', async () => {
    const users = dataSource.getRepository(User);
    const posts = dataSource.getRepository(Post);
    const comments = dataSource.getRepository(Comment);

    const userId = newRoom();
    await users.insert({ id: userId, name: 'Grace' });
    const postIds = [newMessageId(), newMessageId(), newMessageId()];
    for (const [index, postId] of postIds.entries()) {
      await posts.insert({ authorId: userId, postId, title: `post ${index}` });
    }
    await comments.insert({
      postId: postIds[2],
      commentId: newMessageId(),
      body: 'first!',
    });

    const user = await users.findOne(
      { id: userId },
      { include: { posts: { limit: 2, include: ['comments', 'author'] } } },
    );

    expect(user?.posts?.map((p) => p.title)).toEqual(['post 2', 'post 1']);
    expect(user?.posts?.[0].comments?.map((c) => c.body)).toEqual(['first!']);
    expect(user?.posts?.[1].comments).toEqual([]);
    expect(user?.posts?.[0].author?.name).toBe('Grace');
    expect(JSON.parse(JSON.stringify(user)).posts[0].author.name).toBe('Grace');
  });
});

describe('injection against Cassandra', () => {
  it('stores hostile strings as plain data', async () => {
    const payload = `'); DROP TABLE messages_by_room; -- " OR 1=1`;
    const roomId = newRoom();
    const messageId = newMessageId();

    await messages.insert({
      roomId,
      messageId,
      body: payload,
      tags: [payload],
    });
    await messages.update(
      { roomId, messageId },
      { body: payload },
      { if: { body: payload } },
    );

    const found = await messages.findOne({ roomId, messageId });
    expect(found?.body).toBe(payload);
    expect(found?.tags).toEqual([payload]);

    // A hostile value in a key position is just a value that matches nothing.
    await expect(messages.find({ roomId: payload })).rejects.toThrow(
      /Invalid UUID|uuid/i,
    );
    expect(await messages.findOne({ roomId, messageId })).not.toBeNull();
  });
});
