import { Entity } from '../../cassandra/decorators/entity.decorator';

@Entity({ tableName: 'users' })
export class User {
  id: string;
  name: string;
  email: string;
}
