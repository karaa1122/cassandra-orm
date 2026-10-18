import type { Client } from 'cassandra-driver';
import { describe, expect, it, vi } from 'vitest';
import {
  BelongsTo,
  Column,
  getEntityMetadata,
  HasMany,
  InvalidQueryError,
  PartitionKey,
  Repository,
  Table,
} from '../src';
import { Post, User } from './fixtures/entities';

/** Answers from in-memory tables keyed by the CQL table name. */
function fakeClient(tables: Record<string, Record<string, unknown>[]>) {
  const execute = vi.fn<
    (query: string, params: unknown[], options: unknown) => Promise<unknown>
  >(async (query, params) => {
    const table = /FROM "([^"]+)"/.exec(query)![1];
    const column = /WHERE "([^"]+)" = \?/.exec(query)?.[1];
    const rows = (tables[table] ?? []).filter(
      (row) => !column || row[column] === params[0],
    );
    return {
      rows,
      pageState: null,
      first: () => rows[0] ?? null,
      async *[Symbol.asyncIterator]() {
        yield* rows;
      },
    };
  });
  return { client: { execute } as unknown as Client, execute };
}

const ada = { id: 'u1', name: 'Ada' };
const posts = [
  { author_id: 'u1', post_id: 'p1', title: 'one' },
  { author_id: 'u1', post_id: 'p2', title: 'two' },
  { author_id: 'u2', post_id: 'p3', title: 'orphan' },
];

describe('relations', () => {
  it('records relation metadata', () => {
    expect(
      getEntityMetadata(Post).relations.map((r) => [
        r.propertyName,
        r.kind,
        r.on,
      ]),
    ).toEqual([
      ['author', 'belongsTo', { authorId: 'id' }],
      ['comments', 'hasMany', { postId: 'postId' }],
    ]);
  });

  it('loads belongsTo with one query per distinct key', async () => {
    const { client, execute } = fakeClient({
      posts_by_author: posts,
      users: [ada],
    });
    const repo = new Repository<Post>(client, getEntityMetadata(Post));

    const result = await repo.find({}, { include: ['author'] });

    expect(result.map((p) => p.author?.name ?? null)).toEqual([
      'Ada',
      'Ada',
      null,
    ]);
    expect(result[0].author).toBeInstanceOf(User);
    // 1 for posts + 1 per distinct author (u1, u2), not one per post.
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('loads hasMany with per-parent limits', async () => {
    const { client, execute } = fakeClient({
      users: [ada],
      posts_by_author: posts,
    });
    const repo = new Repository<User>(client, getEntityMetadata(User));

    const user = await repo.findOne(
      { id: 'u1' },
      { include: { posts: { limit: 1, orderBy: { postId: 'ASC' } } } },
    );

    expect(user?.posts?.map((p) => p.title)).toEqual(['one', 'two']);
    const [query, params] = execute.mock.calls[1];
    expect(query).toContain('ORDER BY "post_id" ASC LIMIT ?');
    expect(params).toEqual(['u1', 1]);
  });

  it('sets empty values when the foreign key is null', async () => {
    const { client, execute } = fakeClient({
      posts_by_author: [{ author_id: null, post_id: 'p', title: 't' }],
    });
    const repo = new Repository<Post>(client, getEntityMetadata(Post));

    const [post] = await repo.find(
      {},
      { include: { author: true, comments: true } },
    );

    expect(post.author).toBeNull();
    expect(post.comments).toEqual([]);
    // No users lookup for a null author_id (comments are keyed by post_id).
    expect(
      execute.mock.calls.map(([query]) => /FROM "(\w+)"/.exec(query)![1]),
    ).toEqual(['posts_by_author', 'comments_by_post']);
  });

  it('rejects unknown relations and misplaced options', async () => {
    const { client } = fakeClient({ posts_by_author: posts });
    const repo = new Repository<Post>(client, getEntityMetadata(Post));

    await expect(
      repo.find({}, { include: ['title'] as never }),
    ).rejects.toThrow(/no relation "title"/);
    await expect(
      repo.find({}, { include: { author: { limit: 1 } } }),
    ).rejects.toThrow(/only apply to @HasMany/);
  });

  it('refuses relations that would need a scan instead of a key lookup', async () => {
    @Table('tags')
    class Tag {
      @PartitionKey({ type: 'text' })
      name!: string;
      @Column({ type: 'text' })
      label!: string;
    }
    @Table('labelled')
    class Labelled {
      @PartitionKey({ type: 'text' })
      id!: string;
      @Column({ type: 'text' })
      label!: string;
      // `label` is not Tag's partition key: Cassandra would have to scan.
      @HasMany(() => Tag, { on: { label: 'label' } })
      tags?: Tag[];
    }
    const { client, execute } = fakeClient({
      labelled: [{ id: '1', label: 'x' }],
    });
    const repo = new Repository<Labelled>(client, getEntityMetadata(Labelled));

    const attempt = repo.find({}, { include: ['tags'] });
    await expect(attempt).rejects.toThrow(InvalidQueryError);
    await expect(repo.find({}, { include: ['tags'] })).rejects.toThrow(
      /Cannot load relation Labelled.tags: .*"label" is not part of the primary key/,
    );
    // Only the parent queries ran; the invalid relation query never did.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('validates relation declarations', () => {
    @Table()
    class BadSource {
      @PartitionKey({ type: 'text' })
      id!: string;
      @BelongsTo(() => User, { on: { missing: 'id' } })
      user?: User;
    }
    expect(() => getEntityMetadata(BadSource)).toThrow(
      /"missing" in the "on" mapping is not a column/,
    );
  });
});
