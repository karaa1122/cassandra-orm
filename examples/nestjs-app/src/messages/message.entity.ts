import {
  ClusteringKey,
  Column,
  PartitionKey,
  Table,
} from '@cassandra-orm/core';

/** One partition per room, newest message first. */
@Table('messages_by_room')
export class Message {
  @PartitionKey({ type: 'uuid' })
  roomId!: string;

  @ClusteringKey({ type: 'timeuuid', order: 'DESC' })
  messageId!: string;

  @Column({ type: 'text' })
  author!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'timestamp' })
  sentAt!: Date;
}
