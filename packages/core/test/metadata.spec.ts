import { describe, expect, it } from 'vitest';
import {
  ClusteringKey,
  Column,
  EntityMetadataError,
  getEntityMetadata,
  PartitionKey,
  Table,
} from '../src';
import { Message, PageViews, SensorReading } from './fixtures/entities';

describe('entity metadata', () => {
  it('maps properties to snake_case columns in declaration order', () => {
    const metadata = getEntityMetadata(Message);

    expect(metadata.table).toBe('messages_by_room');
    expect(
      metadata.columns.map((c) => [c.propertyName, c.name, c.type, c.kind]),
    ).toEqual([
      ['roomId', 'room_id', 'uuid', 'partition'],
      ['messageId', 'message_id', 'timeuuid', 'clustering'],
      ['body', 'body', 'text', 'regular'],
      ['tags', 'tags', 'set<text>', 'regular'],
      ['roomName', 'room_name', 'text', 'static'],
    ]);
    expect(metadata.clusteringKeys[0].order).toBe('DESC');
    expect(metadata.isCounterTable).toBe(false);
  });

  it('derives the table name and honours column name overrides', () => {
    const metadata = getEntityMetadata(SensorReading);

    expect(metadata.table).toBe('sensor_reading');
    expect(metadata.partitionKeys.map((c) => c.name)).toEqual([
      'sensor_id',
      'day',
    ]);
    expect(metadata.clusteringKeys.map((c) => c.order)).toEqual(['ASC', 'ASC']);
  });

  it('detects counter tables', () => {
    expect(getEntityMetadata(PageViews).isCounterTable).toBe(true);
  });

  it('inherits columns from base classes', () => {
    abstract class Audited {
      @Column({ type: 'timestamp' })
      createdAt!: Date;
    }
    @Table()
    class Note extends Audited {
      @PartitionKey({ type: 'uuid' })
      id!: string;
    }

    expect(getEntityMetadata(Note).columns.map((c) => c.name)).toEqual([
      'created_at',
      'id',
    ]);
  });

  it('rejects classes without @Table()', () => {
    class Plain {}
    expect(() => getEntityMetadata(Plain)).toThrow(/Decorate it with @Table/);
  });

  it('rejects entities without a partition key', () => {
    @Table()
    class NoKey {
      @Column({ type: 'text' })
      name!: string;
    }
    expect(() => getEntityMetadata(NoKey)).toThrow(EntityMetadataError);
  });

  it('rejects counters mixed with regular columns', () => {
    @Table()
    class Mixed {
      @PartitionKey({ type: 'text' })
      id!: string;
      @Column({ type: 'counter' })
      hits!: number;
      @Column({ type: 'text' })
      label!: string;
    }
    expect(() => getEntityMetadata(Mixed)).toThrow(/only contain counters/);
  });

  it('rejects static columns on tables without clustering keys', () => {
    @Table()
    class StaticOnly {
      @PartitionKey({ type: 'text' })
      id!: string;
      @Column({ type: 'text', static: true })
      shared!: string;
    }
    expect(() => getEntityMetadata(StaticOnly)).toThrow(/static columns/);
  });

  it('rejects two properties mapped to the same column', () => {
    @Table()
    class Clash {
      @PartitionKey({ type: 'text' })
      id!: string;
      @ClusteringKey({ type: 'text', name: 'id' })
      other!: string;
    }
    expect(() => getEntityMetadata(Clash)).toThrow(/both map to column "id"/);
  });

  it('rejects malformed CQL types', () => {
    @Table()
    class BadType {
      @PartitionKey({ type: 'map<text, int' as never })
      id!: string;
    }
    expect(() => getEntityMetadata(BadType)).toThrow(/Malformed CQL type/);
  });
});
