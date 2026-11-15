/**
 * Black-box: the booted image refuses state-changing requests from another
 * site, on every route that changes state.
 *
 * The unit suites prove middleware's Origin check on requests built in
 * memory. This sends real requests to the container the Self-host smoke test
 * just built and booted, so it also proves the compiled middleware runs in
 * front of every mutating handler the image actually serves: a route the
 * matcher misses, or a handler that answers before the check, shows up here.
 *
 * Skipped unless VULNRADAR_ATTACK_URL names that container, which only the
 * Self-host smoke test sets:
 *
 *   VULNRADAR_ATTACK_URL=http://localhost:3000 npx vitest run tests/attack
 *
 * Only that address is contacted. Every request is sequential, with a `{}`
 * JSON body, and carries X-Forwarded-Proto: https, as the TLS terminator the
 * image is deployed behind sends: without it the app redirects plain HTTP to
 * https, and a redirect would look like "not refused" to every case below.
 *
 * The routes come from tests/_helpers/api-routes.ts and the exemptions from
 * lib/api/route-registry.ts, so neither list is repeated here and the suite
 * follows the routes when they move.
 */
import { describe, it, expect } from "vitest";
import { mutatingHandlers, type MutatingHandler } from "../_helpers/api-routes";
import { matchV4, resolveApiPath } from "@/lib/api/route-registry";
import { AUTH_SESSION_COOKIE_NAME } from "@/lib/config/constants";

const BASE = process.env.VULNRADAR_ATTACK_URL?.replace(/\/+$/, "");

/** A path the router serves for a route template. */
function concretePath(template: string): string {
  return template
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":"))
        return "00000000-0000-4000-8000-000000000000";
      if (segment.startsWith("*")) return segment.slice(1);
      return segment;
    })
    .join("/");
}

/**
 * Whether the registry, the source of truth middleware reads, exempts a path
 * from the Origin check. A v3 file that has not moved yet answers for the
 * operation it will become.
 */
function registryCsrfExempt(path: string): boolean {
  const resolved = resolveApiPath(path, false, []);
  switch (resolved.kind) {
    case "permalink":
      return resolved.link.csrfExempt === true;
    case "v4":
    case "alias":
      return resolved.route?.csrfExempt === true;
    case "legacy-v3":
      return matchV4(path.slice("/api/v3".length))?.csrfExempt === true;
    default:
      return false;
  }
}

/**
 * Whether a Bearer key belongs to the space a path resolves to, which is what
 * lets it stand in for the Origin header: v4, its v3 aliases and legacy v3,
 * as middleware's acceptsBearer() decides. Anywhere else a key waives nothing.
 */
function registryAcceptsBearer(path: string): boolean {
  const resolved = resolveApiPath(path, true, []);
  return (
    resolved.kind === "v4" ||
    resolved.kind === "legacy-v3" ||
    (resolved.kind === "alias" && resolved.target === "v4")
  );
}

interface Answer {
  status: number;
  body: string;
}

/** Middleware's refusal: a 403 naming the Origin check. */
function isCsrfRejection(a: Answer): boolean {
  if (a.status !== 403) return false;
  try {
    const parsed = JSON.parse(a.body) as { code?: unknown; error?: unknown };
    return (
      parsed.code === "CSRF_REJECTED" ||
      (typeof parsed.error === "string" &&
        parsed.error.startsWith("CSRF check failed"))
    );
  } catch {
    return false;
  }
}

const SELF_ORIGIN = (() => {
  if (!BASE) return "";
  const u = new URL(BASE);
  return `https://${u.host}`;
})();

async function send(
  h: MutatingHandler,
  headers: Record<string, string>,
): Promise<Answer> {
  const res = await fetch(`${BASE}${concretePath(h.route.template)}`, {
    method: h.method,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-Proto": "https",
      ...headers,
    },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, body: await res.text() };
}

const label = (h: MutatingHandler) =>
  `${h.method} ${concretePath(h.route.template)}`;

/** Fails on an answer that proves nothing about the Origin check. */
function expectReachedPastMiddleware(h: MutatingHandler, a: Answer) {
  // A redirect means the request never reached the check at all, and a 429
  // means something limited it before anything could be said.
  expect(a.status >= 300 && a.status < 400, `${label(h)}: ${a.status}`).toBe(
    false,
  );
  expect(a.status, `${label(h)} was rate limited`).not.toBe(429);
  expect(isCsrfRejection(a), `${label(h)}: ${a.status} ${a.body}`).toBe(false);
}

const handlers = mutatingHandlers();
const exempt = handlers.filter((h) =>
  registryCsrfExempt(concretePath(h.route.template)),
);
const guarded = handlers.filter((h) => !exempt.includes(h));
const keyed = guarded.filter((h) =>
  registryAcceptsBearer(concretePath(h.route.template)),
);
const keyless = guarded.filter((h) => !keyed.includes(h));

// Built at run time, never a literal: it is not a key, only key-shaped.
const FAKE_KEY = `vr_live_${"0".repeat(64)}`;

// The walk itself, checked in the Test job too, where the live half skips.
describe("the walk", () => {
  it("builds a concrete path for every template", () => {
    expect(concretePath("/api/v3/history/:id/notes")).toBe(
      "/api/v3/history/00000000-0000-4000-8000-000000000000/notes",
    );
    expect(concretePath("/api/*path")).toBe("/api/path");
  });

  it("exempts exactly the handlers that carry their own credential", () => {
    // A change here is a change to who can be made to write cross-site, so
    // it is pinned rather than derived: the webhook is signed, the
    // unsubscribe link carries its own token, the demo scan is anonymous.
    expect(exempt.map(label).sort()).toEqual([
      "POST /api/v3/account/unsubscribe",
      "POST /api/v3/demo-scan",
      "POST /api/v3/webhooks/stripe",
    ]);
  });
});

describe.skipIf(!BASE)("cross-site writes against the booted image", () => {
  it("found every mutating handler, and split them by the registry", () => {
    expect(handlers.length).toBeGreaterThan(0);
    expect(guarded.length + exempt.length).toBe(handlers.length);
    expect(guarded.length).toBeGreaterThan(exempt.length);
  });

  it(
    "refuses a request from another site's Origin on every guarded handler",
    { timeout: 600_000 },
    async () => {
      let checked = 0;
      for (const h of guarded) {
        const a = await send(h, { Origin: "https://cross-site.invalid" });
        expect(isCsrfRejection(a), `${label(h)}: ${a.status} ${a.body}`).toBe(
          true,
        );
        checked++;
      }
      expect(checked).toBe(guarded.length);
    },
  );

  it(
    "refuses Sec-Fetch-Site: cross-site with no Origin",
    { timeout: 600_000 },
    async () => {
      let checked = 0;
      for (const h of guarded) {
        const a = await send(h, { "Sec-Fetch-Site": "cross-site" });
        expect(isCsrfRejection(a), `${label(h)}: ${a.status} ${a.body}`).toBe(
          true,
        );
        checked++;
      }
      expect(checked).toBe(guarded.length);
    },
  );

  it(
    "refuses the session cookie with no Origin, which is what a cross-site form sends",
    { timeout: 600_000 },
    async () => {
      let checked = 0;
      for (const h of guarded) {
        const a = await send(h, {
          Cookie: `${AUTH_SESSION_COOKIE_NAME}=vrci-not-a-session`,
        });
        expect(isCsrfRejection(a), `${label(h)}: ${a.status} ${a.body}`).toBe(
          true,
        );
        checked++;
      }
      expect(checked).toBe(guarded.length);
    },
  );

  it(
    "lets a Bearer key with no Origin through to the handler, as API clients send it",
    { timeout: 600_000 },
    async () => {
      expect(keyed.length).toBeGreaterThan(0);
      let checked = 0;
      for (const h of keyed) {
        expectReachedPastMiddleware(
          h,
          await send(h, { Authorization: `Bearer ${FAKE_KEY}` }),
        );
        checked++;
      }
      expect(checked).toBe(keyed.length);
    },
  );

  it(
    "refuses a Bearer key with no Origin where the API space takes no key",
    { timeout: 600_000 },
    async () => {
      let checked = 0;
      for (const h of keyless) {
        const a = await send(h, { Authorization: `Bearer ${FAKE_KEY}` });
        expect(isCsrfRejection(a), `${label(h)}: ${a.status} ${a.body}`).toBe(
          true,
        );
        checked++;
      }
      expect(checked).toBe(keyless.length);
    },
  );

  it(
    "lets its own Origin through, with no credentials (the control)",
    { timeout: 600_000 },
    async () => {
      let checked = 0;
      for (const h of guarded) {
        expectReachedPastMiddleware(h, await send(h, { Origin: SELF_ORIGIN }));
        checked++;
      }
      expect(checked).toBe(guarded.length);
    },
  );

  // Once each: the demo scan charges its per-IP limit before it validates
  // anything, so a second request would answer 429 for a reason unrelated
  // to the Origin check.
  it(
    "never refuses an exempt handler on Origin",
    { timeout: 120_000 },
    async () => {
      for (const h of exempt) {
        expectReachedPastMiddleware(
          h,
          await send(h, { Origin: "https://cross-site.invalid" }),
        );
      }
    },
  );
});
