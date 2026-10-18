import type { types } from 'cassandra-driver';
import {
  BelongsTo,
  ClusteringKey,
  Column,
  HasMany,
  PartitionKey,
  Table,
} from '../../src';

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

  @Column({ type: 'text', static: true })
  roomName?: string | null;
}

/** Composite partition key and two clustering columns. */
@Table()
export class SensorReading {
  @PartitionKey({ type: 'text' })
  sensorId!: string;

  @PartitionKey({ type: 'date', name: 'day' })
  bucket!: string;

  @ClusteringKey({ type: 'timestamp' })
  recordedAt!: Date;

  @ClusteringKey({ type: 'int' })
  seq!: number;

  @Column({ type: 'double' })
  value!: number;
}

@Table('page_views')
export class PageViews {
  @PartitionKey({ type: 'text' })
  page!: string;

  @Column({ type: 'counter' })
  views!: types.Long;
}

@Table('users')
export class User {
  @PartitionKey({ type: 'uuid' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @HasMany(() => Post, { on: { id: 'authorId' } })
  posts?: Post[];
}

/** Partitioned by author, so "posts of a user" is a single-partition read. */
@Table('posts_by_author')
export class Post {
  @PartitionKey({ type: 'uuid' })
  authorId!: string;

  @ClusteringKey({ type: 'timeuuid', order: 'DESC' })
  postId!: string;

  @Column({ type: 'text' })
  title!: string;

  @BelongsTo(() => User, { on: { authorId: 'id' } })
  author?: User | null;

  @HasMany(() => Comment, { on: { postId: 'postId' } })
  comments?: Comment[];
}

@Table('comments_by_post')
export class Comment {
  @PartitionKey({ type: 'timeuuid' })
  postId!: string;

  @ClusteringKey({ type: 'timeuuid' })
  commentId!: string;

  @Column({ type: 'text' })
  body!: string;
}
