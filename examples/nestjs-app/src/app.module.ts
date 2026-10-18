import { CassandraModule } from '@cassandra-orm/nestjs';
import { Module } from '@nestjs/common';
import { MessagesModule } from './messages/messages.module.js';

@Module({
  imports: [
    CassandraModule.forRoot({
      contactPoints: (
        process.env.CASSANDRA_CONTACT_POINTS ?? '127.0.0.1:9042'
      ).split(','),
      localDataCenter: process.env.CASSANDRA_DC ?? 'datacenter1',
      keyspace: process.env.CASSANDRA_KEYSPACE ?? 'chat',
      // Creates tables for entities registered with forFeature(). Dev only.
      autoLoadEntities: true,
      synchronize: true,
    }),
    MessagesModule,
  ],
})
export class AppModule {}
