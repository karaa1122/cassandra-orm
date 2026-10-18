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

1. Bump `version` in `packages/core/package.json` and `packages/nestjs/package.json`, then commit and push. Wait for CI to go green.
2. Pack with **pnpm**, which builds each package (`prepack`) and rewrites `workspace:` ranges to real versions:

   ```bash
   mkdir -p /tmp/release
   (cd packages/core && pnpm pack --pack-destination /tmp/release)
   (cd packages/nestjs && pnpm pack --pack-destination /tmp/release)
   ```

3. Publish the tarballs from an **interactive terminal**, `core` first. npm requires 2FA for publishing; with a security key or passkey it prints a link ("Press ENTER to open in the browser") to approve in the browser:

   ```bash
   npm publish /tmp/release/cassandra-orm-core-<version>.tgz --access public
   npm publish /tmp/release/cassandra-orm-nestjs-<version>.tgz --access public
   ```

   With an authenticator app, `pnpm -r --filter "./packages/*" publish --access public --otp=<code>` does steps 2 and 3 in one go. Never run plain `npm publish` inside a package folder: it would ship the unrewritten `workspace:^` range.

Publishing requires membership in the [`cassandra-orm`](https://www.npmjs.com/org/cassandra-orm) npm org.
