import { Module, Global } from '@nestjs/common';
import { Client } from 'cassandra-driver';

@Global()
@Module({})
export class CassandraModule {
  static register(options: { contactPoints: string[]; keyspace: string }) {
    const client = new Client({
      contactPoints: options.contactPoints,
      localDataCenter: 'datacenter1',
      keyspace: options.keyspace,
    });

    return {
      module: CassandraModule,
      providers: [
        {
          provide: 'CASSANDRA_CLIENT',
          useValue: client,
        },
      ],
      exports: ['CASSANDRA_CLIENT'],
    };
  }
}
