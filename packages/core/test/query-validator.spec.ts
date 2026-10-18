import { describe, expect, it } from 'vitest';
import { getEntityMetadata, InvalidQueryError } from '../src';
import {
  validateDelete,
  validateSelect,
  validateUpdate,
} from '../src/query/query-validator';
import { normalizeWhere } from '../src/query/where';
import { Message, SensorReading } from './fixtures/entities';

const messages = getEntityMetadata(Message);
const readings = getEntityMetadata(SensorReading);
const day = '2026-10-18';

function select(
  metadata = readings,
  where: object,
  options: Parameters<typeof validateSelect>[2] = {},
) {
  return () =>
    validateSelect(metadata, normalizeWhere(metadata, where), options);
}

describe('normalizeWhere', () => {
  it('treats plain values as equality and $-objects as operators', () => {
    const restrictions = normalizeWhere(readings, {
      sensorId: 's1',
      recordedAt: { $gte: new Date(0), $lt: new Date(1) },
    });
    expect(restrictions.map((r) => [r.column.name, r.operator])).toEqual([
      ['sensor_id', '='],
      ['recorded_at', '>='],
      ['recorded_at', '<'],
    ]);
  });

  it('refuses undefined values instead of dropping the condition', () => {
    expect(() => normalizeWhere(messages, { roomId: undefined })).toThrow(
      /undefined/,
    );
  });

  it('refuses null outside of conditions', () => {
    expect(() => normalizeWhere(messages, { body: null })).toThrow(/null/);
    expect(
      normalizeWhere(messages, { body: null }, { allowNull: true }),
    ).toHaveLength(1);
  });

  it('rejects unknown properties and operators', () => {
    expect(() => normalizeWhere(messages, { nope: 1 })).toThrow(
      /no mapped property "nope"/,
    );
    expect(() => normalizeWhere(messages, { messageId: { $ne: 'x' } })).toThrow(
      /Unknown operator "\$ne"/,
    );
  });

  it('rejects contradictory operator combinations', () => {
    expect(() =>
      normalizeWhere(messages, { messageId: { $in: ['a'], $gt: 'b' } }),
    ).toThrow(/cannot combine \$in/);
    expect(() =>
      normalizeWhere(messages, { messageId: { $gt: 'a', $gte: 'b' } }),
    ).toThrow(/at most one lower/);
  });
});

describe('validateSelect', () => {
  it('accepts the full partition key with a clustering prefix and trailing range', () => {
    expect(
      select(readings, {
        sensorId: 's1',
        bucket: day,
        recordedAt: new Date(0),
        seq: { $gt: 3 },
      }),
    ).not.toThrow();
  });

  it('accepts IN on partition and clustering columns', () => {
    expect(
      select(readings, { sensorId: { $in: ['a', 'b'] }, bucket: day }),
    ).not.toThrow();
  });

  it('accepts a query without any restriction (full scan)', () => {
    expect(select(readings, {})).not.toThrow();
  });

  it('rejects an incomplete partition key', () => {
    expect(select(readings, { sensorId: 's1' })).toThrow(
      /partition key is incomplete \(missing "bucket"\)/,
    );
  });

  it('rejects ranges on the partition key', () => {
    expect(select(readings, { sensorId: { $gt: 'a' }, bucket: day })).toThrow(
      /equality or \$in/,
    );
  });

  it('rejects filtering on regular columns', () => {
    expect(select(messages, { roomId: 'r', body: 'hi' })).toThrow(
      /"body" is not part of the primary key/,
    );
  });

  it('rejects clustering restrictions without the partition key', () => {
    expect(select(readings, { seq: 1 })).toThrow(
      /without the full partition key/,
    );
  });

  it('rejects gaps in the clustering prefix', () => {
    expect(select(readings, { sensorId: 's1', bucket: day, seq: 1 })).toThrow(
      /"seq" is restricted but the preceding "recordedAt" is not/,
    );
  });

  it('rejects restrictions after a clustering range', () => {
    expect(
      select(readings, {
        sensorId: 's1',
        bucket: day,
        recordedAt: { $gt: new Date(0) },
        seq: 1,
      }),
    ).toThrow(/after a range on "recordedAt"/);
  });

  it('lets allowFiltering through', () => {
    expect(
      select(messages, { body: 'hi' }, { allowFiltering: true }),
    ).not.toThrow();
  });

  it('throws InvalidQueryError', () => {
    expect(select(messages, { body: 'hi' })).toThrow(InvalidQueryError);
  });

  describe('orderBy', () => {
    const recordedAt = readings.findColumn('recordedAt')!;
    const seq = readings.findColumn('seq')!;
    const where = { sensorId: 's1', bucket: day };

    it('accepts the clustering order and its exact reverse', () => {
      expect(
        select(readings, where, {
          orderBy: [{ column: recordedAt, direction: 'ASC' }],
        }),
      ).not.toThrow();
      expect(
        select(readings, where, {
          orderBy: [
            { column: recordedAt, direction: 'DESC' },
            { column: seq, direction: 'DESC' },
          ],
        }),
      ).not.toThrow();
    });

    it('rejects mixed directions', () => {
      expect(
        select(readings, where, {
          orderBy: [
            { column: recordedAt, direction: 'DESC' },
            { column: seq, direction: 'ASC' },
          ],
        }),
      ).toThrow(/exact reverse/);
    });

    it('rejects skipping clustering columns', () => {
      expect(
        select(readings, where, {
          orderBy: [{ column: seq, direction: 'ASC' }],
        }),
      ).toThrow(/clustering column order/);
    });

    it('requires the partition key', () => {
      expect(
        select(
          readings,
          {},
          {
            orderBy: [{ column: recordedAt, direction: 'ASC' }],
          },
        ),
      ).toThrow(/requires the full partition key/);
    });
  });
});

describe('validateUpdate', () => {
  const update =
    (where: object, conditional = false) =>
    () =>
      validateUpdate(messages, normalizeWhere(messages, where), {
        conditional,
      });

  it('requires the full primary key', () => {
    expect(update({ roomId: 'r', messageId: 'm' })).not.toThrow();
    expect(update({ roomId: 'r' })).toThrow(/"messageId" is missing/);
  });

  it('rejects ranges and regular columns', () => {
    expect(update({ roomId: 'r', messageId: { $gt: 'm' } })).toThrow(
      /equality/,
    );
    expect(update({ roomId: 'r', messageId: 'm', body: 'x' })).toThrow(
      /`if` option/,
    );
  });

  it('rejects IN in conditional updates', () => {
    expect(update({ roomId: { $in: ['r'] }, messageId: 'm' })).not.toThrow();
    expect(update({ roomId: { $in: ['r'] }, messageId: 'm' }, true)).toThrow(
      /not allowed/,
    );
  });
});

describe('validateDelete', () => {
  const del =
    (where: object, conditional = false) =>
    () =>
      validateDelete(readings, normalizeWhere(readings, where), {
        conditional,
      });

  it('allows deleting a whole partition or a clustering range', () => {
    expect(del({ sensorId: 's', bucket: day })).not.toThrow();
    expect(
      del({ sensorId: 's', bucket: day, recordedAt: { $lt: new Date() } }),
    ).not.toThrow();
  });

  it('requires the full partition key', () => {
    expect(del({ sensorId: 's' })).toThrow(/"bucket" is missing/);
  });

  it('rejects clustering gaps', () => {
    expect(del({ sensorId: 's', bucket: day, seq: 1 })).toThrow(
      /preceding "recordedAt"/,
    );
  });

  it('requires the full primary key for conditional deletes', () => {
    expect(del({ sensorId: 's', bucket: day }, true)).toThrow(
      /needs the full primary key/,
    );
  });
});
