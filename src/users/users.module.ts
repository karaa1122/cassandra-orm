import { Module } from '@nestjs/common';
import { CassandraModule } from '../cassandra/cassandra.module';
import { UserService } from './services/user.service';
import { CassandraRepository } from '../cassandra/repositories/cassandra.repository';
import { User } from './entities/user.entity';
import { UserController } from './user.controller';

@Module({
  imports: [
    CassandraModule.register({
      contactPoints: ['127.0.0.1'],
      keyspace: 'orm',
    }),
  ],
  providers: [
    {
      provide: 'UserRepository',
      useFactory: (client) => new CassandraRepository<User>(client, 'users'),
      inject: ['CASSANDRA_CLIENT'],
    },
    UserService,
  ],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}