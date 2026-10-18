# Example: NestJS chat API

A NestJS 12 (ESM) app using `@cassandra-orm/nestjs`. Messages are stored one partition per room, newest first.

```bash
# from the repository root
pnpm install && pnpm build

cd examples/nestjs-app
pnpm cassandra:up        # Cassandra 5 in Docker + creates the "chat" keyspace
pnpm start               # http://localhost:3000
```

Wait for the `cassandra-init` container to exit before starting the app (`docker compose ps -a`).

```bash
ROOM=6f1c2a3e-4b5d-4c6e-8f70-819203a4b5c6
curl -X POST localhost:3000/rooms/$ROOM/messages \
  -H 'content-type: application/json' -d '{"author":"ada","body":"hello"}'
curl localhost:3000/rooms/$ROOM/messages              # { items, pageState }
curl "localhost:3000/rooms/$ROOM/messages?pageState=…" # next page
curl -X PATCH localhost:3000/rooms/$ROOM/messages/<messageId> \
  -H 'content-type: application/json' -d '{"body":"edited"}'
curl -X DELETE localhost:3000/rooms/$ROOM/messages/<messageId>
```

Settings come from `CASSANDRA_CONTACT_POINTS`, `CASSANDRA_DC`, `CASSANDRA_KEYSPACE` and `PORT`. Stop Cassandra with `pnpm cassandra:down`.
