import type { EntityClass } from '@cassandra-orm/core';
import { Inject } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from './cassandra.utils';

/** Injects the `Repository` for an entity registered with `forFeature`. */
export const InjectRepository = (
  entity: EntityClass,
  connectionName?: string,
): ParameterDecorator & PropertyDecorator =>
  Inject(getRepositoryToken(entity, connectionName));

/** Injects the connection's `DataSource`. */
export const InjectDataSource = (
  connectionName?: string,
): ParameterDecorator & PropertyDecorator =>
  Inject(getDataSourceToken(connectionName));
