# Tests

There are two tiers, and they follow different rules. Almost everything you
will write is in the first one.

| Tier            | Lives in            | Talks to Postgres | Runs on               |
| --------------- | ------------------- | ----------------- | --------------------- |
| **Unit**        | `tests/` (the rest) | No, `pg` is faked | `npm test`, CI `Test` |
| **Integration** | `tests/integration` | Yes, a real one   | CI `Integration`      |

The integration tier is excluded from the root vitest config, so
`npm test` is green on a machine with no database. Jump to
[Two tiers, two rules](#two-tiers-two-rules) for which rule applies where.

All tests live here. The directory mirrors the source tree, so the suite for a
file sits at the same path with `tests/` in front and `.test.ts` on the end:

| Source                          | Test                                       |
| ------------------------------- | ------------------------------------------ |
| `lib/auth/password-hash.ts`     | `tests/lib/auth/password-hash.test.ts`     |
| `lib/scanner/checks/headers.ts` | `tests/lib/scanner/checks/headers.test.ts` |
| `app/api/v3/scan/route.ts`      | `tests/app/api/v3/scan/route.test.ts`      |

## Conventions

Import the code under test through the `@/` alias rather than a relative path.
The alias is stable no matter how deep the file sits:

```ts
import { hashPassword } from "@/lib/auth/password-hash";
```

Test-only helpers are prefixed with `_` and live beside the suites that use
them (for example `tests/lib/scanner/checks/_test-harness.ts`). Vitest only
collects `*.test.ts` and `*.spec.ts`, so helpers are never run as suites, and
they are excluded from coverage.

## Running

```bash
npm test              # run once
npm run test:watch    # watch mode
npm run test:coverage # with coverage
```

None of these touch `tests/integration`. That tier has its own config and its
own database:

```bash
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=pw \
  -e POSTGRES_DB=vulnradar_test --name vr-test-db postgres:16.4-alpine

INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5433/vulnradar_test \
  npx vitest run --config tests/integration/vitest.config.ts
```

Without `INTEGRATION_DATABASE_URL` the whole tier skips and prints those two
commands, so running it wrong is self-explaining rather than a wall of
connection errors.

**Point it at a throwaway database.** The bootstrap drops and rebuilds the
public schema. It refuses to run against a database it did not create (it
looks for its own `vulnradar_integration_fixture` marker table) and against
one equal to `DATABASE_URL`, but the first line of defence is you.

## Coverage thresholds

`vitest.config.ts` sets per-file thresholds and only lists files that actually
have tests. Folder-wide thresholds were dragging the average down to near zero
because most of the codebase is still untested. When you add a suite, add its
source file to the `thresholds` map: run `npm run test:coverage`, read the
per-file percentage, and set the threshold a few points below it so a real
regression fails the build without a stale baseline breaking CI.

CI runs `npm run test:coverage`, not `npm test`, so those thresholds are the
gate this paragraph says they are. That was not true for a long stretch: the
Test job ran the suite without coverage, nothing anywhere read the threshold
map, and the one command that did had drifted red against files nobody had
touched, so anyone who ran it locally learned to ignore its output. If
`npm run test:coverage` is red on your branch and every test passes, a
threshold is stale: fix the number and say why in the comment above it, the
way the existing entries do.

Coverage measures the unit tier only. `instrumentation.ts` is excluded from
the report entirely, which used to mean the 4,300-line boot schema was
measured by nothing at all; the integration tier now executes it in full on
every CI run, so it is exercised even though it still reports no percentage.

## Two tiers, two rules

CLAUDE.md lists "mocking the database in tests" under what to avoid. This file
tells you to mock `pool.query`. Both are correct, and here is the line between
them, because it used to read as a contradiction and cost people time.

**Unit tier (`tests/`, everything outside `tests/integration`): fake `pg`.**
Mock at the network and database boundary and not below it. That means mocking
`pool.query` and `fetch` and nothing underneath them: the boundary is the
floor, not a starting point to keep descending from. Four hundred suites run in
under a minute on any laptop with no services to install, and that is worth
keeping.

Know what it costs. With `pool.query` faked, every SQL assertion here is a
string comparison. A query naming a column that does not exist is
indistinguishable from a correct one; a dropped `WHERE`, a `SELECT ... FOR
UPDATE` that lost its lock, and a CTE that stopped returning its `RETURNING`
row all pass. So do not conclude from a green unit suite that a query works.

**Integration tier (`tests/integration`): never fake `pg`, ever.** This is
where CLAUDE.md's rule applies literally. These suites run the real
`instrumentation.ts` boot path against a real PostgreSQL and then execute the
real queries. Anything a fake pool could answer belongs in the unit tier; put
a test here only when the answer depends on what the database actually does.
Today that is: every `ON CONFLICT` target resolving against a live unique
index, the credit ledgers and quota gates under genuine concurrency, the
scan_history insert-then-finalize round trip, the foreign-key graph that
account deletion depends on, and the retention prunes.

The tier is small on purpose. It is slower, it needs a database, and a broad
one nobody runs is worth less than a narrow one that runs on every push.

Two conventions are specific to it. The suites gate on
`describe.skipIf(!hasIntegrationDatabase)`, which is the one sanctioned
exception to "nothing is silently disabled" below: the condition is a single
environment variable and the bootstrap prints what to set. And the CI job
re-reads the run's own JSON to fail if everything skipped, so a job that
proved nothing cannot pass quietly.

## Prefer the real thing over a mock

The same instinct applies below the database boundary too, and it is worth one
worked example of what a mock too far actually costs.

`lib/auth/auth.test.ts` used to mock `node:crypto` and then assert against a
copy of `hashPassword` pasted into the test file. It passed while production signup was completely
broken, because nothing in the suite ever executed the real scrypt parameters.
`tests/lib/auth/password-hash.test.ts` replaced it and calls the real primitive
at the real cost. A few slow tests are worth more than a fast suite that cannot
fail.

## Route suites: fake the boundary, run the real auth

Most route suites replace both `@/lib/database/db` and the whole `@/lib/auth`
module with fakes. That stubs out the exact code an authorization bug lives in:
if `getSession` never runs and the ownership-scoped SQL is never built, a suite
written that way cannot catch a missing owner check.

The stronger pattern, and the one to converge on, is a fake `next/headers`
cookie jar plus a behavioural `pg` fake that answers by SQL prefix and captures
its params. The real `getSession` runs against the fake cookie, and the route's
real query text and parameters are asserted. Two suites to copy from:

- `tests/app/api/v3/auth/trusted-devices/[id]/route.test.ts`
- `tests/app/api/v3/auth/impersonation-stop/route.test.ts`

Convert a route suite to this shape when you are already touching it. Do not
convert the whole tree in one pass.

## Things that stay at zero

The suite is checked to hold these, and a change that breaks one should be
questioned in review rather than merged:

- No `it.only`, `describe.only`, `it.skip`, `describe.skip`, `it.todo`, `xit`,
  or `fdescribe`. Nothing is silently disabled. `tests/integration` uses
  `describe.skipIf` on one environment variable, which is the conditional
  form and announces itself; see "Two tiers, two rules" above.
- No `toMatchSnapshot` / `toMatchInlineSnapshot` and no `__snapshots__`
  directory. Assert the property you care about, not a blob nobody reads.
- No real third-party hostnames. Every URL is `example.com`, a `.test` name,
  `localhost`, or a reserved spec domain, and every fetch is stubbed, so the
  suite runs offline and never touches someone else's service. This binds the
  integration tier too: its bootstrap replaces `globalThis.fetch` with one
  that refuses everything, because the boot path it runs calls the GitHub
  releases API for its version check.
- No assertion inside a `catch` block and no bare `catch {}` in a test body:
  both swallow the failure they were supposed to report. If a call must throw,
  assert that with `expect(...).rejects` / `expect(...).toThrow`.
- No suite mocks the module it is testing.
