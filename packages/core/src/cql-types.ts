export type CqlNativeType =
  | 'ascii'
  | 'bigint'
  | 'blob'
  | 'boolean'
  | 'counter'
  | 'date'
  | 'decimal'
  | 'double'
  | 'duration'
  | 'float'
  | 'inet'
  | 'int'
  | 'smallint'
  | 'text'
  | 'time'
  | 'timestamp'
  | 'timeuuid'
  | 'tinyint'
  | 'uuid'
  | 'varchar'
  | 'varint';

/**
 * A CQL column type. Native types autocomplete; parameterized types are
 * written as in CQL, e.g. `set<text>`, `map<uuid, int>`, `frozen<address>`,
 * `vector<float, 3>`.
 */
export type CqlType =
  | CqlNativeType
  | `list<${string}>`
  | `set<${string}>`
  | `map<${string}>`
  | `tuple<${string}>`
  | `frozen<${string}>`
  | `vector<${string}>`;

export interface ParsedCqlType {
  name: string;
  params: ParsedCqlType[];
}

/** Parses `map<uuid, frozen<list<text>>>` into a type tree. */
export function parseCqlType(type: string): ParsedCqlType {
  let pos = 0;

  const parse = (): ParsedCqlType => {
    const start = pos;
    while (pos < type.length && !'<>,'.includes(type[pos])) pos++;
    const name = type.slice(start, pos).trim().toLowerCase();
    // The type is written verbatim into CREATE TABLE, so only accept plain
    // (optionally keyspace-qualified) identifiers and vector dimensions.
    if (!/^(?:[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?|\d+)$/.test(name)) {
      throw new Error(`Malformed CQL type "${type}"`);
    }
    const params: ParsedCqlType[] = [];
    if (type[pos] === '<') {
      pos++;
      params.push(parse());
      while (type[pos] === ',') {
        pos++;
        params.push(parse());
      }
      if (type[pos] !== '>') {
        throw new Error(`Malformed CQL type "${type}"`);
      }
      pos++;
    }
    return { name, params };
  };

  const parsed = parse();
  if (pos !== type.length) {
    throw new Error(`Malformed CQL type "${type}"`);
  }
  return parsed;
}

/**
 * Converts a value decoded by cassandra-driver into the shape entities expose.
 * uuid and timeuuid become strings (also inside collections); everything else
 * keeps the driver's representation.
 */
export function fromDriverValue(type: ParsedCqlType, value: unknown): unknown {
  if (value === null || value === undefined) return value;

  switch (type.name) {
    case 'uuid':
    case 'timeuuid':
      return String(value);
    case 'frozen':
      return fromDriverValue(type.params[0], value);
    case 'list':
    case 'set': {
      const [element] = type.params;
      if (!needsConversion(element)) return value;
      if (value instanceof Set) {
        return new Set([...value].map((v) => fromDriverValue(element, v)));
      }
      return (value as unknown[]).map((v) => fromDriverValue(element, v));
    }
    case 'map': {
      const [keyType, valueType] = type.params;
      if (!needsConversion(keyType) && !needsConversion(valueType)) {
        return value;
      }
      if (value instanceof Map) {
        return new Map(
          [...value].map(([k, v]) => [
            fromDriverValue(keyType, k),
            fromDriverValue(valueType, v),
          ]),
        );
      }
      // Plain-object maps already have string keys.
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          fromDriverValue(valueType, v),
        ]),
      );
    }
    default:
      return value;
  }
}

function needsConversion(type: ParsedCqlType): boolean {
  return (
    type.name === 'uuid' ||
    type.name === 'timeuuid' ||
    type.params.some(needsConversion)
  );
}
