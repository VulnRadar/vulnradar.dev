# Tests

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

## Coverage thresholds

`vitest.config.ts` sets per-file thresholds and only lists files that actually
have tests. Folder-wide thresholds were dragging the average down to near zero
because most of the codebase is still untested. When you add a suite, add its
source file to the `thresholds` map: run `npm run test:coverage`, read the
per-file percentage, and set the threshold a few points below it so a real
regression fails the build without a stale baseline breaking CI.

## Prefer the real thing over a mock

Mock at the network and database boundary, not below it. `lib/auth/auth.test.ts`
used to mock `node:crypto` and then assert against a copy of `hashPassword`
pasted into the test file. It passed while production signup was completely
broken, because nothing in the suite ever executed the real scrypt parameters.
`tests/lib/auth/password-hash.test.ts` replaced it and calls the real primitive
at the real cost. A few slow tests are worth more than a fast suite that cannot
fail.
