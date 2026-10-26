# API rewrite spike

Proves the Next.js routing claims the API v4 Move rests on (spec 14.1), on the
Next version this repository pins, before any route file moves. Nothing here
runs in `npm test` and nothing here imports product code.

## What it is

A small Next app in `fixture/` that models the compatibility layer: a
middleware that rewrites `/api/v3/<tail>` to `/api/v4/<tail>` or
`/api/internal/<tail>` with `aliasRewrite` (copied from spec 4.2), forwards
request headers, and sets the deprecation and security headers on the
response. Its routes echo what they receive, stream NDJSON and CSV, return
binary and error responses, and export the same `maxDuration` as the real
verify route.

`scripts/spike/run.mjs` builds that app in a scratch directory outside the
repository and serves it three ways, because the claims are about Next's own
router and each mode builds it differently:

| Target    | Command                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `dev`     | `next dev`                                                              |
| `start`   | `next start`, with the image's `PORT` and `HOSTNAME` in the environment |
| `start-h` | `next start -H 0.0.0.0` (bare metal, Pterodactyl)                       |
| `image`   | a container built like the production image (`tests/spike/Dockerfile`)  |

The image is not a standalone build, and neither is the real one: it copies
`.next` and `node_modules` and runs `npm start`. `scripts/spike/selftest.mjs`
fails if this Dockerfile drifts from the production one on the lines the spike
depends on.

## The checks

| SPIKE | Claim                                                                                     | Checks                |
| ----- | ----------------------------------------------------------------------------------------- | --------------------- |
| 1     | `rewrite(url, { request: { headers } })` delivers headers to the handler                  | 1a to 1e              |
| 2     | params survive, static beats dynamic beats catch-all, the rewrite never leaves the origin | 2a to 2d              |
| 3     | every method, bodies up to 1 MiB, query strings, unbuffered NDJSON and CSV                | 3a to 3f              |
| 4     | Deprecation, Sunset, Link, CSP and x-request-id reach the client                          | 4a to 4h              |
| 5     | what `request.url` is inside the handler and inside middleware                            | 5a to 5c              |
| 6     | the destination's `maxDuration` is the one the build records                              | 6a, 6b                |
| 7     | parse plus stringify of a 5 MB body (a node benchmark, no server)                         | `bench-serialise.mjs` |

Most checks compare the alias with the direct route (`/api/v3/x` against
`/api/v4/x`) instead of asserting a fixed answer, so a quirk Next has anyway
is not blamed on the rewrite.

SPIKE 2c is the one with no fallback. It sends aliases with a hostile `Host`
and `X-Forwarded-Host` to a recording listener and requires that the listener
sees no connection. `2c-control` first proves the listener would see one: a
deliberately unsafe rewrite built from the Host header is proxied to it, with
the Cookie, the Authorization header and the body. Without that control a
clean result would only mean the listener was unreachable.

That control is an open proxy by design, and the fixture listens on every
interface of the machine running it, so the route answers only a caller that
holds a per-run random token (`SPIKE_CONTROL_TOKEN`, handed to the server by
the harness) and returns 404 to everyone else. `2c-control` checks that refusal
before it sends the real control.

## Proving the harness can fail

A table that has only ever said PASS has not shown it can say anything else.
`scripts/spike/mutations.mjs` lists ten deliberate breakages of the fixture:
the rewrite built without the forwarded headers, a client marker that survives
on a page path, a destination built from the Host header, a path encoded twice,
a handler that is not given the query string, a truncated body, a buffered
stream, a lost `Deprecation` header, an origin that reflects the Host, a
different `maxDuration`. SPIKE 1 to 6 each have at least one. `node scripts/spike/run.mjs --mutate all` applies each to the
scratch copy, runs the checks that should notice, and exits non-zero if one of
them still passes. `summarise.mjs` prints the result under the table, and
`selftest.mjs` fails when a mutation's target text no longer exists in the
fixture, so a fixture edit cannot quietly disarm one.

## Running it

Locally, against the repository's `node_modules`, on port 3104:

```bash
node scripts/spike/selftest.mjs
node scripts/spike/run.mjs --target start --out spike-results
node --expose-gc scripts/spike/bench-serialise.mjs --out spike-results
node scripts/spike/summarise.mjs spike-results
```

`--target` takes `dev`, `start`, `start-h`, `image` or `all`. The image target
needs Docker. In CI the workflow `.github/workflows/spike-api-rewrite.yml`
runs everything with `--install`, which installs the three pinned packages
once instead of linking `node_modules`, and writes the table to the job
summary.

Results are plain JSON, one file per target, so a later run can be diffed
against an earlier one.
