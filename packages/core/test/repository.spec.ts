import type { Client } from 'cassandra-driver';
import { types } from 'cassandra-driver';
import { describe, expect, it, vi } from 'vitest';
import { getEntityMetadata, InvalidQueryError, Repository } from '../src';
import { Message, PageViews } from './fixtures/entities';

function fakeClient(rows: Record<string, unknown>[] = []) {
  const execute = vi.fn<
    (query: string, params: unknown[], options: unknown) => Promise<unknown>
  >(async () => ({
    rows,
    pageState: null,
    first: () => rows[0] ?? null,
    wasApplied: () => true,
  }));
  return { client: { execute } as unknown as Client, execute };
}

describe('Repository (no database)', () => {
  it('maps rows to entity instances and uuids to strings', async () => {
    const roomId = types.Uuid.random();
    const { client } = fakeClient([
      {
        room_id: roomId,
        message_id: types.TimeUuid.now(),
        body: 'hi',
        tags: null,
        room_name: 'general',
      },
    ]);
    const repo = new Repository<Message>(client, getEntityMetadata(Message));

    const message = await repo.findOne({ roomId: roomId.toString() });

    expect(message).toBeInstanceOf(Message);
    expect(message?.roomId).toBe(roomId.toString());
    expect(typeof message?.messageId).toBe('string');
    expect(message?.roomName).toBe('general');
  });

  it('always prepares and marks reads idempotent', async () => {
    const { client, execute } = fakeClient();
    const repo = new Repository<Message>(client, getEntityMetadata(Message));

    await repo.findPage({ roomId: 'r' }, { pageSize: 20, consistency: 1 });

    expect(execute).toHaveBeenCalledWith(expect.any(String), ['r'], {
      prepare: true,
      isIdempotent: true,
      fetchSize: 20,
      pageState: undefined,
      consistency: 1,
    });
  });

  it('binds unset for undefined values on insert', async () => {
    const { client, execute } = fakeClient();
    const repo = new Repository<Message>(client, getEntityMetadata(Message));

    await repo.insert({ roomId: 'r', messageId: 'm', body: 'hi' });

    expect(execute.mock.calls[0][1]).toEqual([
      'r',
      'm',
      'hi',
      types.unset,
      types.unset,
    ]);
  });

  it('validates before touching the database', async () => {
    const { client, execute } = fakeClient();
    const repo = new Repository<Message>(client, getEntityMetadata(Message));

    await expect(repo.find({ body: 'hi' })).rejects.toThrow(InvalidQueryError);
    await expect(repo.delete({ roomId: undefined })).rejects.toThrow(
      /undefined/,
    );
    await expect(repo.insert({ roomId: 'r', body: 'x' })).rejects.toThrow(
      /"messageId" is undefined/,
    );
    await expect(
      repo.update({ roomId: 'r', messageId: 'm' }, { roomId: 'x' }),
    ).rejects.toThrow(/cannot be updated/);
    await expect(
      repo.insert(
        { roomId: 'r', messageId: 'm' },
        { ifNotExists: true, timestamp: 1 },
      ),
    ).rejects.toThrow(/custom timestamp/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('only increments counter columns, and never retries them', async () => {
    const { client, execute } = fakeClient();
    const repo = new Repository<PageViews>(
      client,
      getEntityMetadata(PageViews),
    );

    await expect(repo.insert({ page: '/' })).rejects.toThrow(/counter table/);
    await repo.increment({ page: '/' }, { views: 1 });

    expect(execute).toHaveBeenCalledWith(
      'UPDATE "page_views" SET "views" = "views" + ? WHERE "page" = ?',
      ['1', '/'],
      { prepare: true, isIdempotent: false },
    );
  });
});
