import { Inject } from '@nestjs/common';
import { Client } from 'cassandra-driver';

export class CassandraRepository<T> {
  constructor(
    @Inject('CASSANDRA_CLIENT') private readonly client: Client,
    private readonly tableName: string,
  ) {}

  async create(data: Partial<T>): Promise<void> {
    const keys = Object.keys(data).join(', ');
    const values = Object.values(data).map(() => '?').join(', ');
    const query = `INSERT INTO ${this.tableName} (${keys}) VALUES (${values})`;

    await this.client.execute(query, Object.values(data), { prepare: true });
  }

  async findAll(limit: number, page: number): Promise<T[]> {
    const offset = (page - 1) * limit;
    const query = `SELECT * FROM ${this.tableName} LIMIT ? OFFSET ?`;
    const result = await this.client.execute(query, [limit, offset], {
      prepare: true,
    });
    return result.rows as T[];
  }

  async findById(id: string | number): Promise<T | null> {
    const query = `SELECT * FROM ${this.tableName} WHERE id = ?`;
    const result = await this.client.execute(query, [id], { prepare: true });
    return result.rowLength > 0 ? (result.first() as T) : null;
  }
}
