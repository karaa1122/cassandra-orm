# Contributing

Thanks for helping! The repo is a pnpm workspace:

```
packages/core     @cassandra-orm/core: the ORM (no framework dependencies)
packages/nestjs   @cassandra-orm/nestjs: NestJS module and decorators
examples/         runnable apps using the packages
test/             shared integration-test setup (Testcontainers)
```

## Setup

Requires Node 22.12+, pnpm 9 and Docker (for integration tests).

```bash
pnpm install
pnpm build              # core -> nestjs -> examples
pnpm test               # unit tests, no database needed
pnpm test:integration   # starts Cassandra 5 in Docker via Testcontainers
pnpm lint && pnpm format:check && pnpm typecheck
```

Integration tests start one container for the whole run. To iterate faster against a Cassandra you already have running:

```bash
CASSANDRA_CONTACT_POINT=127.0.0.1:9042 pnpm test:integration
CASSANDRA_IMAGE=cassandra:4.1 pnpm test:integration          # other versions
```

## Guidelines

- `@cassandra-orm/core` must never import from `@nestjs/*` or any other framework.
- Values always go through bind markers (`?`); anything interpolated into CQL text must come from entity metadata or a fixed allow-list. Add a test to `security.spec.ts` when touching query building.
- New query features need both a unit test (generated CQL, validation) and an integration test against a real cluster.
- Keep error messages actionable: say what is wrong and what to do instead.

## Releasing

Publish with **pnpm** (not npm) so `workspace:` ranges are rewritten to real versions:

```bash
pnpm -r --filter "./packages/*" publish --access public
```

`prepack` builds each package first. The `@cassandra-orm` npm scope must belong to the publishing account.
