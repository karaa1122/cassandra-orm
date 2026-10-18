import { CassandraContainer } from '@testcontainers/cassandra';
import type { TestProject } from 'vitest/node';

export interface CassandraTestConfig {
  contactPoint: string;
  localDataCenter: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    cassandra: CassandraTestConfig;
  }
}

/**
 * Starts one Cassandra container for the whole integration run. Set
 * CASSANDRA_CONTACT_POINT (and optionally CASSANDRA_DC) to reuse a running
 * cluster instead, which makes local iteration much faster.
 */
export default async function setup(project: TestProject) {
  if (process.env.CASSANDRA_CONTACT_POINT) {
    project.provide('cassandra', {
      contactPoint: process.env.CASSANDRA_CONTACT_POINT,
      localDataCenter: process.env.CASSANDRA_DC ?? 'datacenter1',
    });
    return;
  }

  const image = process.env.CASSANDRA_IMAGE ?? 'cassandra:5.0';
  const container = await new CassandraContainer(image).start();
  project.provide('cassandra', {
    contactPoint: container.getContactPoint(),
    localDataCenter: container.getDatacenter(),
  });

  return async () => {
    await container.stop();
  };
}
