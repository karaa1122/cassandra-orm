import { Injectable, Inject } from '@nestjs/common';
import { CassandraRepository } from '../../cassandra/repositories/cassandra.repository';
import { User } from '../entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @Inject('UserRepository')
    private readonly userRepository: CassandraRepository<User>,
  ) {}

  async createUser(user: User): Promise<void> {
    await this.userRepository.create(user);
  }

  async getAllUsers(limit: number, page: number): Promise<User[]> {
    return this.userRepository.findAll(limit, page);
  }

  async findUserById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }
}