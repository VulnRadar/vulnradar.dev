/**
 * Every active probe module, aggregated behind one entry point for
 * lib/scanner/async-checks.ts's buildBranches. See shared.ts for the
 * opt-in / domain-ownership contract every probe here follows.
 */
import type { Vulnerability } from "../types";
import { checkActiveProbes } from "./xss-canary";
import { checkSqlInjectionProbe } from "./sqli-error-based";
import { checkSstiProbe } from "./ssti";
import { checkCommandInjectionProbe } from "./command-injection";
import { checkOpenRedirectProbe } from "./open-redirect";

export { checkActiveProbes } from "./xss-canary";
export { checkSqlInjectionProbe } from "./sqli-error-based";
export { checkSstiProbe } from "./ssti";
export { checkCommandInjectionProbe } from "./command-injection";
export { checkOpenRedirectProbe } from "./open-redirect";

type ActiveProbe = (
  url: string,
  cancelSignal?: AbortSignal,
) => Promise<Vulnerability[]>;

/** Every form/URL-driven active probe in this directory, run together as a
 *  single Promise.allSettled batch. Does NOT include checkGraphQLIntrospection
 *  (lib/scanner/async-checks.ts): that probe needs the request origin, not
 *  just the URL, and stays alongside the rest of async-checks.ts's live-fetch
 *  infrastructure it shares helpers with. */
export const ACTIVE_PROBES: ActiveProbe[] = [
  checkActiveProbes,
  checkSqlInjectionProbe,
  checkSstiProbe,
  checkCommandInjectionProbe,
  checkOpenRedirectProbe,
];

/**
 * Run every probe in ACTIVE_PROBES concurrently and flatten the results,
 * tolerating individual probe failures (Promise.allSettled) the same way
 * every other async-checks.ts branch does.
 */
export async function runActiveProbes(
  url: string,
  cancelSignal?: AbortSignal,
): Promise<Vulnerability[]> {
  const results = await Promise.allSettled(
    ACTIVE_PROBES.map((probe) => probe(url, cancelSignal)),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
