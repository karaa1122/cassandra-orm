import type { Client } from 'cassandra-driver';
import { describe, expect, it, vi } from 'vitest';
import {
  Column,
  getEntityMetadata,
  InvalidQueryError,
  PartitionKey,
  Repository,
  Table,
} from '../src';
import { buildSelect } from '../src/query/cql-builder';
import { Message } from './fixtures/entities';

const INJECTION = `x'; DROP TABLE messages_by_room; --`;

function recordingRepository() {
  const execute = vi.fn<
    (query: string, params: unknown[], options: unknown) => Promise<unknown>
  >(async () => ({
    rows: [],
    pageState: null,
    first: () => null,
    wasApplied: () => true,
    async *[Symbol.asyncIterator]() {},
  }));
  const repository = new Repository<Message>(
    { execute } as unknown as Client,
    getEntityMetadata(Message),
  );
  return { repository, execute };
}

describe('CQL injection', () => {
  it('never puts values into the query text', async () => {
    const { repository, execute } = recordingRepository();

    await repository.find({ roomId: INJECTION, messageId: { $lt: INJECTION } });
    await repository.insert({
      roomId: INJECTION,
      messageId: INJECTION,
      body: INJECTION,
    });
    await repository.update(
      { roomId: INJECTION, messageId: INJECTION },
      { body: INJECTION },
      { if: { body: INJECTION } },
    );
    await repository.delete({ roomId: INJECTION });

    for (const [query, params, options] of execute.mock.calls) {
      expect(query).not.toContain('DROP');
      expect(params).toContain(INJECTION);
      expect(options).toMatchObject({ prepare: true });
    }
  });

  it('rejects orderBy directions other than ASC/DESC', async () => {
    const { repository, execute } = recordingRepository();

    await expect(
      repository.find(
        { roomId: 'r' },
        { orderBy: { messageId: 'ASC; DROP TABLE x' as never } },
      ),
    ).rejects.toThrow(/must be 'ASC' or 'DESC'/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects property names that are not mapped columns', async () => {
    const { repository, execute } = recordingRepository();
    const hostile = JSON.parse(
      `{"room_id\\" = 'x' OR \\"1": "1", "__proto__": "x"}`,
    );

    await expect(repository.find(hostile)).rejects.toThrow(InvalidQueryError);
    await expect(
      repository.find(
        { roomId: 'r' },
        { orderBy: { [INJECTION]: 'ASC' } as never },
      ),
    ).rejects.toThrow(/no mapped property/);
    await expect(
      repository.update({ roomId: 'r', messageId: 'm' }, hostile),
    ).rejects.toThrow(/no mapped property/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('only accepts known operators, ignoring the object prototype', async () => {
    const { repository } = recordingRepository();

    for (const key of ['toString', 'constructor', '$where', '__proto__']) {
      const where = JSON.parse(`{"roomId": {"$gt": "a", "${key}": "b"}}`);
      await expect(repository.find(where)).rejects.toThrow(/Unknown operator/);
    }
  });

  it('validates numeric options instead of trusting their type', async () => {
    const { repository, execute } = recordingRepository();
    const evil = '1; DROP TABLE x' as never;

    await expect(
      repository.find({ roomId: 'r' }, { limit: evil }),
    ).rejects.toThrow(/limit must be an integer/);
    await expect(
      repository.find({ roomId: 'r' }, { limit: 0 }),
    ).rejects.toThrow(/limit/);
    await expect(
      repository.findPage({ roomId: 'r' }, { pageSize: -5 }),
    ).rejects.toThrow(/pageSize/);
    await expect(
      repository.insert({ roomId: 'r', messageId: 'm' }, { ttl: evil }),
    ).rejects.toThrow(/ttl/);
    await expect(
      repository.delete({ roomId: 'r' }, { timestamp: evil }),
    ).rejects.toThrow(/timestamp/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects CQL types that could smuggle DDL', () => {
    @Table()
    class Smuggler {
      @PartitionKey({ type: 'text' })
      id!: string;
      @Column({ type: "text, evil int) WITH comment = 'x'; --" as never })
      payload!: string;
    }
    expect(() => getEntityMetadata(Smuggler)).toThrow(/Malformed CQL type/);
  });

  it('quotes identifiers so table and column names cannot break out', () => {
    @Table({ name: 'odd"table', keyspace: 'odd"ks' })
    class Odd {
      @PartitionKey({ type: 'text', name: 'odd"col' })
      id!: string;
    }
    const { query } = buildSelect(getEntityMetadata(Odd), { restrictions: [] });
    expect(query).toBe('SELECT "odd""col" FROM "odd""ks"."odd""table"');
  });
});
