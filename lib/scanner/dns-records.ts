// ════════════════════════════════════════════════════════════════════════════
// FULL DNS RECORD SET
//
// During a scan, VulnRadar's DNS checks (lib/scanner/async-checks.ts's
// checkDNSSecurity) already resolve a couple dozen record types to derive
// findings, then discard the raw records. This module fetches the domain's
// full record set once more as STRUCTURED DATA -- not findings -- so the
// result surfaces can render a "fetch full DNS" panel the way competing
// scanners do, and so a later scheduled-refresh layer can update the same
// shape in place.
//
// Everything here is node:dns/promises only, so it is self-contained and
// unit-testable by mocking the resolver module. Record types that node:dns
// cannot query natively (DNSKEY, DS) are deliberately omitted -- the DNSSEC
// findings that need them already go through DNS-over-HTTPS in async-checks.ts,
// and this panel is about the records a client actually resolves.
//
// Correctness posture: every record type is fetched with its own per-query
// timeout inside Promise.allSettled, so one failing/slow record type can never
// reject the whole thing -- a domain with an A record but no MX still returns a
// populated object, it just has an empty `mx` array.
// ════════════════════════════════════════════════════════════════════════════

// The record-shape interfaces are declared on the callback `dns` module, not
// on `dns/promises` (which only re-exports the promise-returning functions).
import type { MxRecord, CaaRecord, SoaRecord } from "dns";
// Shared per-scan DNS memo. checkDNSSecurity has already resolved most of
// these record types by the time it calls resolveDnsRecords at the end of the
// same scan, so going through the memo makes this panel free rather than a
// second full sweep. Outside a scan (a standalone call) it passes straight
// through to the resolver. ref: AUDIT-012#perf-09
import {
  resolveTxtOnce,
  resolveMxOnce,
  resolveNsOnce,
  resolveSoaOnce,
  resolveCnameOnce,
  resolveCaaOnce,
  resolve4Once,
  resolve6Once,
} from "./dns-memo";

/** A single MX record: mail exchanger hostname plus its preference value. */
export interface DnsMxRecord {
  priority: number;
  exchange: string;
}

/** Parsed SOA (Start of Authority) fields, one per zone. */
export interface DnsSoaRecord {
  nsname: string;
  hostmaster: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minttl: number;
}

/**
 * The full structured DNS record set for one hostname. Each field is the
 * parsed, display-ready value for that record type; arrays are empty (never
 * absent) when the type resolved to nothing, so a consumer can always read
 * `records.mx.length` without a guard. `soa` is null when the zone returned
 * no SOA.
 *
 * `resolvedAt` timestamps the capture so a later scheduled-refresh pass can
 * show "as of" and decide when the snapshot is stale -- that refresh layer is
 * intentionally not built here.
 */
export interface DnsRecords {
  /** The hostname these records were resolved for, lowercased. */
  hostname: string;
  /** ISO-8601 timestamp of when the records were resolved. */
  resolvedAt: string;
  /** IPv4 addresses (A records). */
  a: string[];
  /** IPv6 addresses (AAAA records). */
  aaaa: string[];
  /** Canonical name targets (CNAME); usually empty at a zone apex. */
  cname: string[];
  /** Mail exchangers, sorted by ascending priority. */
  mx: DnsMxRecord[];
  /** Authoritative nameservers (NS). */
  ns: string[];
  /** TXT records, each record's chunks joined into one string. */
  txt: string[];
  /** CAA records, each formatted as `<flags> <tag> "<value>"`. */
  caa: string[];
  /** Parsed SOA fields, or null when none was returned. */
  soa: DnsSoaRecord | null;
}

const DEFAULT_QUERY_TIMEOUT_MS = 4000;

/**
 * Run one resolver call with a hard per-query timeout and optional abort. Node's
 * dns/promises functions have no built-in deadline (against an unresponsive
 * resolver they hang on the c-ares retry chain for tens of seconds), so every
 * query is raced against a timer, mirroring async-checks.ts's withDnsTimeout.
 */
function queryWithTimeout<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_QUERY_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("dns query timeout"));
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort);

    fn().then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function settledStrings(r: PromiseSettledResult<string[]>): string[] {
  if (r.status !== "fulfilled" || !Array.isArray(r.value)) return [];
  return r.value.map((v) => String(v).trim()).filter(Boolean);
}

function settledMx(r: PromiseSettledResult<MxRecord[]>): DnsMxRecord[] {
  if (r.status !== "fulfilled" || !Array.isArray(r.value)) return [];
  return r.value
    .filter((m) => m && typeof m.exchange === "string")
    .map((m) => ({ priority: m.priority ?? 0, exchange: m.exchange.trim() }))
    .sort((a, b) => a.priority - b.priority);
}

function settledTxt(r: PromiseSettledResult<string[][]>): string[] {
  if (r.status !== "fulfilled" || !Array.isArray(r.value)) return [];
  // resolveTxt returns each record as an array of ≤255-char chunks that a
  // client concatenates back into the original string (long SPF/DKIM records
  // are split across chunks at the wire level).
  return r.value
    .map((chunks) => (Array.isArray(chunks) ? chunks.join("") : String(chunks)))
    .filter(Boolean);
}

function formatCaa(record: CaaRecord): string {
  const flags = record.critical ?? 0;
  if (record.issue !== undefined) return `${flags} issue "${record.issue}"`;
  if (record.issuewild !== undefined)
    return `${flags} issuewild "${record.issuewild}"`;
  if (record.iodef !== undefined) return `${flags} iodef "${record.iodef}"`;
  if (record.contactemail !== undefined)
    return `${flags} contactemail "${record.contactemail}"`;
  if (record.contactphone !== undefined)
    return `${flags} contactphone "${record.contactphone}"`;
  return `${flags}`;
}

function settledCaa(r: PromiseSettledResult<CaaRecord[]>): string[] {
  if (r.status !== "fulfilled" || !Array.isArray(r.value)) return [];
  return r.value.filter(Boolean).map(formatCaa);
}

function settledSoa(r: PromiseSettledResult<SoaRecord>): DnsSoaRecord | null {
  if (r.status !== "fulfilled" || !r.value) return null;
  const s = r.value;
  return {
    nsname: s.nsname,
    hostmaster: s.hostmaster,
    serial: s.serial,
    refresh: s.refresh,
    retry: s.retry,
    expire: s.expire,
    minttl: s.minttl,
  };
}

/**
 * Resolve the full structured DNS record set for `hostname`. Never rejects on
 * an individual record type failing (Promise.allSettled) -- a missing type just
 * yields an empty array. The whole operation is bounded by each query's own
 * timeout and the optional `signal`.
 */
export async function resolveDnsRecords(
  hostname: string,
  signal?: AbortSignal,
): Promise<DnsRecords> {
  const host = hostname.trim().toLowerCase();

  const [a, aaaa, cname, mx, ns, txt, caa, soa] = await Promise.allSettled([
    queryWithTimeout(() => resolve4Once(host), signal),
    queryWithTimeout(() => resolve6Once(host), signal),
    queryWithTimeout(() => resolveCnameOnce(host), signal),
    queryWithTimeout(() => resolveMxOnce(host), signal),
    queryWithTimeout(() => resolveNsOnce(host), signal),
    queryWithTimeout(() => resolveTxtOnce(host), signal),
    queryWithTimeout(() => resolveCaaOnce(host), signal),
    queryWithTimeout(() => resolveSoaOnce(host), signal),
  ]);

  return {
    hostname: host,
    resolvedAt: new Date().toISOString(),
    a: settledStrings(a),
    aaaa: settledStrings(aaaa),
    cname: settledStrings(cname),
    mx: settledMx(mx),
    ns: settledStrings(ns),
    txt: settledTxt(txt),
    caa: settledCaa(caa),
    soa: settledSoa(soa),
  };
}

/** True when at least one record of any type was captured. */
export function hasAnyDnsRecords(records: DnsRecords): boolean {
  return (
    records.a.length > 0 ||
    records.aaaa.length > 0 ||
    records.cname.length > 0 ||
    records.mx.length > 0 ||
    records.ns.length > 0 ||
    records.txt.length > 0 ||
    records.caa.length > 0 ||
    records.soa !== null
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PER-HOST SIDE CHANNEL
//
// resolveDnsRecords runs inside checkDNSSecurity (lib/scanner/async-checks.ts),
// down in the async DNS branch whose return value is flattened to a
// Vulnerability[] on the way back to the scan pipeline -- there is no room to
// carry structured data alongside the findings. So, exactly like
// lib/scanner/ssl-grade.ts's grade store, checkDNSSecurity records the record
// set here keyed by hostname, and execute-scan.ts / execute-crawl-scan.ts read
// it back when they assemble result_meta.
//
// Keying by hostname is correct: two concurrent scans of the same host observe
// the same records, and a crawl's many same-host pages resolve to one entry.
// Reads peek (don't delete) so concurrent readers each see the value; entries
// are pruned by TTL on write so the map can never grow unbounded.
// ════════════════════════════════════════════════════════════════════════════

const RECORDS_TTL_MS = 5 * 60 * 1000;
const recordsStore = new Map<string, { records: DnsRecords; at: number }>();

function pruneRecordsStore(now: number): void {
  for (const [key, entry] of recordsStore) {
    if (now - entry.at > RECORDS_TTL_MS) recordsStore.delete(key);
  }
}

/** Stash a freshly resolved record set for `hostname` (called from checkDNSSecurity). */
export function recordDnsRecords(hostname: string, records: DnsRecords): void {
  const now = Date.now();
  pruneRecordsStore(now);
  recordsStore.set(hostname.toLowerCase(), { records, at: now });
}

/** Read back the record set recorded for `hostname`, or undefined if none/stale. */
export function readDnsRecords(hostname: string): DnsRecords | undefined {
  const entry = recordsStore.get(hostname.toLowerCase());
  if (!entry) return undefined;
  if (Date.now() - entry.at > RECORDS_TTL_MS) {
    recordsStore.delete(hostname.toLowerCase());
    return undefined;
  }
  return entry.records;
}
