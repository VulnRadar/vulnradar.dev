/**
 * VulnRadar, scanned by VulnRadar.
 *
 * Fetches every route the sitemap publishes from a running instance and runs
 * the same synchronous engine a real scan runs over each response. Skipped
 * unless VULNRADAR_SELF_SCAN_URL names the instance, so the ordinary suite
 * never makes a network request:
 *
 *   VULNRADAR_SELF_SCAN_URL=https://sandbox.vulnradar.dev npx vitest run tests/selfscan
 *
 * Optional:
 *   VULNRADAR_SELF_SCAN_REPORT=path.json  writes every finding, accepted or not
 *   VULNRADAR_SELF_SCAN_LIMIT=50          scans only the first N routes
 *   VULNRADAR_SELF_SCAN_BEHIND_TLS=1      the instance is reached directly over
 *     plain HTTP but deployed behind a TLS terminator, which is the only
 *     supported production shape (CI's container). Requests carry
 *     X-Forwarded-Proto: https, as that terminator would send, and each page
 *     is judged at its https URL on the default port, which is what a visitor
 *     gets. Without it a CI run would be scanning a transport nobody uses.
 *
 * A finding is either a defect in the app, which gets fixed, a defect in the
 * check, which gets fixed, or an accepted finding listed in ACCEPTED below
 * with the reason it is not a defect. There is no fourth option: nothing here
 * special-cases our own hostname, and a check is never weakened to pass.
 */

import fs from "node:fs";
import { describe, it, expect } from "vitest";
import { runSyncChecks } from "@/lib/scanner/engine";
import { checkIdOf } from "@/lib/scanner/dedupe";
import { safeReadBody } from "@/lib/scanner/read-bounded-body";
import { PUBLIC_ROUTES } from "@/lib/seo/routes";
import { APP_NAME } from "@/lib/config/constants";

const BASE = process.env.VULNRADAR_SELF_SCAN_URL?.replace(/\/+$/, "");
const REPORT = process.env.VULNRADAR_SELF_SCAN_REPORT;
const LIMIT = Number(process.env.VULNRADAR_SELF_SCAN_LIMIT) || Infinity;
const BEHIND_TLS = process.env.VULNRADAR_SELF_SCAN_BEHIND_TLS === "1";
// The engine's default body cap (CONFIG_SCAN_MAX_BODY_BYTES ships 1 MiB).
const MAX_BODY_BYTES = 1_048_576;
const CONCURRENCY = 6;

/**
 * Findings that are true of our own site and are not defects, keyed by check
 * id. Each entry says why. An entry here accepts the check on every route, so
 * keep the reason specific enough that a reader can tell when it stops being
 * true.
 */
const ACCEPTED: Readonly<Record<string, string>> = {
  "csp-framework-required":
    "Info. Our CSP keeps style-src 'unsafe-inline' because Radix's scroll lock (react-remove-scroll) injects <style> elements at runtime and server-rendered React style props arrive as style attributes. script-src is nonce-locked with 'strict-dynamic', which is where 'unsafe-inline' would be exploitable. Revisit if style-src ever drops 'unsafe-inline'.",
  "inline-style-attr":
    "Info. Severity pills set their colour through a React style prop (hsl(var(--severity-*))), which renders as a style attribute: 810 of them on /checks. They carry no user data and are permitted by the same style-src 'unsafe-inline' above; converting them would not let that directive go.",
  "swagger-docs-exposed":
    "Low. We publish our OpenAPI 3.1 description on purpose at /api/v3/openapi.json and link it from /docs/api and the playground. Revisit if the spec ever lists internal or admin-only operations.",
};

interface RouteResult {
  path: string;
  status: number;
  finalUrl: string;
  error?: string;
  findings: {
    checkId: string;
    severity: string;
    title: string;
    evidence: string;
    accepted: boolean;
  }[];
}

async function scanRoute(path: string): Promise<RouteResult> {
  const url = `${BASE}${path}`;
  // The terminator serves 443, so the direct port goes with the scheme.
  const judged = (u: string) =>
    BEHIND_TLS ? u.replace(/^http:\/\/([^/:]+)(?::\d+)?/i, "https://$1") : u;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": `${APP_NAME}/1.0 (Security Scanner)`,
        ...(BEHIND_TLS ? { "X-Forwarded-Proto": "https" } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await safeReadBody(res, MAX_BODY_BYTES);
    const { findings } = runSyncChecks(
      judged(url),
      res.headers,
      body,
      null,
      undefined,
      judged(res.url || url),
    );
    return {
      path,
      status: res.status,
      finalUrl: res.url || url,
      findings: findings.map((f) => {
        const checkId = checkIdOf(f);
        return {
          checkId,
          severity: f.severity,
          title: f.title,
          evidence: String(f.evidence ?? "").slice(0, 400),
          accepted: checkId in ACCEPTED,
        };
      }),
    };
  } catch (err) {
    return {
      path,
      status: 0,
      finalUrl: url,
      error: err instanceof Error ? err.message : String(err),
      findings: [],
    };
  }
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

describe.skipIf(!BASE)("self-scan", () => {
  it(
    "every published route passes the engine",
    { timeout: 1_800_000 },
    async () => {
      const paths = [...new Set(PUBLIC_ROUTES.map((r) => r.path))].slice(
        0,
        LIMIT,
      );
      const results = await mapPool(paths, CONCURRENCY, scanRoute);

      if (REPORT) {
        fs.writeFileSync(
          REPORT,
          JSON.stringify(
            { base: BASE, scannedAt: new Date().toISOString(), results },
            null,
            2,
          ),
        );
      }

      const unreachable = results
        .filter((r) => r.error || r.status >= 400)
        .map((r) => `${r.path} (${r.error ?? r.status})`);

      const byCheck = new Map<string, string[]>();
      for (const r of results) {
        for (const f of r.findings) {
          if (f.accepted) continue;
          const key = `${f.checkId} [${f.severity}]`;
          byCheck.set(key, [...(byCheck.get(key) ?? []), r.path]);
        }
      }
      const unaccepted = [...byCheck]
        .sort((a, b) => b[1].length - a[1].length)
        .map(
          ([check, routes]) =>
            `${check} on ${routes.length} route(s), e.g. ${routes.slice(0, 3).join(", ")}`,
        );

      expect(unreachable, "published routes that did not load").toEqual([]);
      expect(unaccepted, "findings on our own site").toEqual([]);
    },
  );
});
