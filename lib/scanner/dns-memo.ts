/**
 * Per-scan memo for the informational DNS record lookups the scan makes.
 *
 * async-checks.ts's checkDNSSecurity fans 28 sub-checks out in one
 * Promise.allSettled and every one of them resolved the same names
 * independently: resolveMx(domain) ran four times inside that file alone
 * (hasNullMX, checkMX, checkBackupMX, checkMXHostnameCname), twice more from
 * checks/dns.ts's checkNullMxRecommended, and once more from dns-records.ts's
 * full record-set fetch at the end of the same call. resolveTxt(domain),
 * resolveSoa, resolveNs and _mta-sts.<domain> were each resolved twice, and
 * checkDKIMWeakKey re-probed ten of the exact selector hosts checkDKIM had
 * just probed. Roughly 90 to 110 queries per scan, most of them repeats.
 * ref: AUDIT-012#perf-09
 *
 * `withDnsMemo` is entered once, in checkDNSSecurity, and holds a Map that
 * lives only for that one call. There is deliberately no cross-call TTL
 * cache. A longer-lived one would hand a later scan a stale record, and it
 * would make each sub-check's result depend on whatever happened to run
 * before it, which is precisely the coupling the scanner's tests exist to
 * catch. Every sub-check is also exported and tested directly; called that
 * way it runs outside the memo and resolves normally, so its behaviour is
 * unchanged.
 *
 * Only record lookups that end up as finding text or as the DNS panel's data
 * go through here. Nothing that decides whether a request may leave the
 * process does: safe-fetch's validateScanTarget is un-memoized on purpose,
 * because any cache long enough to be worth having serves the first, public
 * answer to the DNS-rebinding re-check it exists to perform (see its doc
 * comment). Do not route `dns.lookup` through this module.
 */

import { AsyncLocalStorage } from "async_hooks";
import * as dns from "dns/promises";

const dnsMemoStore = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Run `fn` with a fresh, empty memo scoped to exactly this call. */
export function withDnsMemo<T>(fn: () => Promise<T>): Promise<T> {
  return dnsMemoStore.run(new Map(), fn);
}

function memoDns<T>(key: string, run: () => Promise<T>): Promise<T> {
  const store = dnsMemoStore.getStore();
  if (!store) return run();
  const hit = store.get(key);
  if (hit) return hit as Promise<T>;
  const pending = run();
  // A rejection is cached too: "this name does not resolve" is the answer
  // several sub-checks act on, and it is the common case for the DKIM
  // selector sweep. The stored handle gets its own no-op catch so a rejection
  // no caller has awaited yet is never reported as unhandled; the caller
  // still awaits `pending` itself and sees the throw.
  pending.catch(() => {});
  store.set(key, pending);
  return pending;
}

export const resolveTxtOnce = (name: string) =>
  memoDns(`txt:${name}`, () => dns.resolveTxt(name));
export const resolveMxOnce = (name: string) =>
  memoDns(`mx:${name}`, () => dns.resolveMx(name));
export const resolveNsOnce = (name: string) =>
  memoDns(`ns:${name}`, () => dns.resolveNs(name));
export const resolveSoaOnce = (name: string) =>
  memoDns(`soa:${name}`, () => dns.resolveSoa(name));
export const resolveCnameOnce = (name: string) =>
  memoDns(`cname:${name}`, () => dns.resolveCname(name));
export const resolveCaaOnce = (name: string) =>
  memoDns(`caa:${name}`, () => dns.resolveCaa(name));
export const resolve4Once = (name: string) =>
  memoDns(`a:${name}`, () => dns.resolve4(name));
export const resolve6Once = (name: string) =>
  memoDns(`aaaa:${name}`, () => dns.resolve6(name));
