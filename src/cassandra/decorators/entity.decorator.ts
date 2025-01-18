export interface EntityOptions {
  tableName: string;
}

export function Entity(options: EntityOptions) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (constructor: Function) {
    Reflect.defineMetadata('entity:table', options.tableName, constructor);
  };
}
