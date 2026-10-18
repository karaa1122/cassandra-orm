import { Client } from 'cassandra-driver';
import { inject } from 'vitest';

/** Connection settings for the cluster started by the global setup. */
export function cassandraConfig() {
  const { contactPoint, localDataCenter } = inject('cassandra');
  return { contactPoints: [contactPoint], localDataCenter };
}

/** Drops and recreates a keyspace so every test file starts clean. */
export async function resetKeyspace(keyspace: string): Promise<void> {
  const client = new Client(cassandraConfig());
  try {
    await client.execute(`DROP KEYSPACE IF EXISTS ${keyspace}`);
    await client.execute(
      `CREATE KEYSPACE ${keyspace} WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
    );
  } finally {
    await client.shutdown();
  }
}
