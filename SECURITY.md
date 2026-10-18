# Security

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the repository's **Security** tab) with a description and, ideally, a reproduction. You'll get a reply within a few days, and a fix will be released before details are made public.

## What the library guarantees

**Values never become CQL text.** Every value you pass (in `where`, `if`, inserted or updated data, `limit`, `ttl`, `timestamp`) is sent as a bound parameter of a prepared statement (`prepare: true`). Cassandra parses the statement before any value is seen, so a value cannot change what the statement does. A value like `'); DROP TABLE x; --` is stored and compared as a plain string; the test suite checks this against a real cluster.

**Identifiers come only from entity metadata.** Table, keyspace and column names are taken from your decorators, never from query input, and are always double-quoted with embedded quotes escaped. Property names in `where`, `if`, `orderBy`, `include` and `update` objects are looked up in the entity metadata. Unknown names are rejected, so request JSON such as `{"room_id\" = 'x' OR \"1": 1}` cannot reach the query.

**The few keywords that are interpolated are allow-listed.** Comparison operators come from a fixed map (`$in`, `$gt`, `$gte`, `$lt`, `$lte`), so keys like `__proto__` or `toString` are rejected. `orderBy` directions must be exactly `ASC` or `DESC`. Numeric options are checked to be integers. CQL types in decorators are validated before they are written into `CREATE TABLE`.

**Dangerous query shapes need explicit opt-in.** Queries that would need `ALLOW FILTERING` are rejected unless the code passes `allowFiltering: true`. `undefined` in a `where` object throws instead of being ignored, so a missing request parameter cannot widen a `delete` or `find`.

## What remains your responsibility

- **Mass assignment.** `insert(req.body)` writes every mapped column present in the body. Validate and whitelist input (for example with DTOs and `class-validator`) before passing it to a repository.
- **`pageState` is opaque, not secret.** It is the driver's paging cursor. Clients can tamper with it, and it is not signed or encrypted. Don't treat it as proof of authorization; enforce access with the `where` clause.
- **`allowFiltering: true` on user-driven queries** can make a single request scan the whole table. Use it only on small tables or internal jobs.
- **Credentials and TLS** are configured on the driver (`credentials`, `sslOptions`); keep them out of source control.
