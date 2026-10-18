import type { EntityClass } from '@cassandra-orm/core';
import { DEFAULT_CONNECTION_NAME } from './cassandra.constants';

/**
 * String tokens (rather than class tokens) keep injection working even when
 * the app ends up with more than one copy of these packages.
 */
export function getDataSourceToken(
  connectionName: string = DEFAULT_CONNECTION_NAME,
): string {
  return connectionName === DEFAULT_CONNECTION_NAME
    ? 'CassandraDataSource'
    : `${connectionName}CassandraDataSource`;
}

export function getRepositoryToken(
  entity: EntityClass,
  connectionName: string = DEFAULT_CONNECTION_NAME,
): string {
  const prefix =
    connectionName === DEFAULT_CONNECTION_NAME ? '' : `${connectionName}_`;
  return `${prefix}${entity.name}CassandraRepository`;
}
