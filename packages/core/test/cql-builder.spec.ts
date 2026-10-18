import { describe, expect, it } from 'vitest';
import { buildCreateTable, getEntityMetadata, quoteIdentifier } from '../src';
import {
  buildDelete,
  buildInsert,
  buildSelect,
  buildUpdate,
} from '../src/query/cql-builder';
import { normalizeWhere } from '../src/query/where';
import { Message, SensorReading } from './fixtures/entities';

const messages = getEntityMetadata(Message);
const readings = getEntityMetadata(SensorReading);
const UNSET = Symbol('unset');

describe('cql builder', () => {
  it('quotes identifiers', () => {
    expect(quoteIdentifier('weird"name')).toBe('"weird""name"');
  });

  it('builds a SELECT with every clause', () => {
    const statement = buildSelect(messages, {
      restrictions: normalizeWhere(messages, {
        roomId: 'r1',
        messageId: { $lt: 'm9' },
      }),
      orderBy: [{ column: messages.clusteringKeys[0], direction: 'ASC' }],
      limit: 10,
      allowFiltering: true,
    });

    expect(statement.query).toBe(
      'SELECT "room_id", "message_id", "body", "tags", "room_name" FROM "messages_by_room" ' +
        'WHERE "room_id" = ? AND "message_id" < ? ORDER BY "message_id" ASC LIMIT ? ALLOW FILTERING',
    );
    expect(statement.params).toEqual(['r1', 'm9', 10]);
  });

  it('builds an INSERT that binds missing values as unset', () => {
    const values = new Map(
      messages.columns.map((c) => [
        c,
        (
          { roomId: 'r', messageId: 'm', body: 'hi' } as Record<string, unknown>
        )[c.propertyName],
      ]),
    );
    const statement = buildInsert(messages, {
      values,
      unset: UNSET,
      ifNotExists: true,
      ttl: 60,
    });

    expect(statement.query).toBe(
      'INSERT INTO "messages_by_room" ("room_id", "message_id", "body", "tags", "room_name") ' +
        'VALUES (?, ?, ?, ?, ?) IF NOT EXISTS USING TTL ?',
    );
    expect(statement.params).toEqual(['r', 'm', 'hi', UNSET, UNSET, 60]);
  });

  it('builds an UPDATE with USING, SET and IF', () => {
    const statement = buildUpdate(messages, {
      restrictions: normalizeWhere(messages, { roomId: 'r', messageId: 'm' }),
      assignments: [
        { column: messages.findColumn('body')!, value: 'edited', mode: 'set' },
      ],
      conditions: normalizeWhere(messages, { body: 'old' }),
      ttl: 5,
      timestamp: 1_700_000_000_000_000n,
    });

    expect(statement.query).toBe(
      'UPDATE "messages_by_room" USING TTL ? AND TIMESTAMP ? SET "body" = ? ' +
        'WHERE "room_id" = ? AND "message_id" = ? IF "body" = ?',
    );
    expect(statement.params).toEqual([
      5,
      '1700000000000000',
      'edited',
      'r',
      'm',
      'old',
    ]);
  });

  it('builds counter increments', () => {
    const statement = buildUpdate(readings, {
      restrictions: [],
      assignments: [
        { column: readings.findColumn('value')!, value: 2, mode: 'increment' },
      ],
    });
    expect(statement.query).toContain('SET "value" = "value" + ?');
    expect(statement.params).toEqual(['2']);
  });

  it('builds a DELETE', () => {
    const statement = buildDelete(messages, {
      restrictions: normalizeWhere(messages, { roomId: 'r' }),
      ifExists: true,
    });
    expect(statement.query).toBe(
      'DELETE FROM "messages_by_room" WHERE "room_id" = ? IF EXISTS',
    );
  });

  it('builds CREATE TABLE with composite keys, static columns and clustering order', () => {
    expect(buildCreateTable(messages)).toBe(
      [
        'CREATE TABLE IF NOT EXISTS "messages_by_room" (',
        '  "room_id" uuid,',
        '  "message_id" timeuuid,',
        '  "body" text,',
        '  "tags" set<text>,',
        '  "room_name" text STATIC,',
        '  PRIMARY KEY ("room_id", "message_id")',
        ') WITH CLUSTERING ORDER BY ("message_id" DESC)',
      ].join('\n'),
    );
    expect(buildCreateTable(readings)).toContain(
      'PRIMARY KEY (("sensor_id", "day"), "recorded_at", "seq")',
    );
  });
});
