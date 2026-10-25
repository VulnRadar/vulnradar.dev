/**
 * What a failed page fetch means, and what to do about it.
 *
 * executeScan used to treat any throw from the page fetch as the end of the
 * scan: one `Could not reach the target URL`, a row marked failed, and the DNS,
 * TLS and reputation checks (which never read the page) never started. That is
 * the right outcome for a scan that could not run at all and the wrong one for
 * a site that answers fine and merely redirects example.com to app.example.com,
 * or serves a certificate the scanner rejects. The second case is the one a
 * TLS check exists to describe, and failing the scan hid it.
 *
 * This reads what safeFetch threw and says which of those it was. It reads it
 * structurally, `err.code ?? err.cause?.code`, and does not import safeFetch:
 * the codes below are the contract (cross_host_redirect | timeout | tls |
 * unreachable | blocked), with the raw Node and undici codes as the fallback
 * for an error that carries none.
 */

import type { FailureKind } from "./failure-kinds";
import { failureKindMessage } from "@/lib/api/scan-error-message";

/** The `ScanResult.incomplete` entry for a scan whose page could not be fetched. */
export const PAGE_UNREACHABLE_INCOMPLETE = "page-unreachable";

/**
 * Plain-language name for that entry, for lib/scanner/incomplete-labels.ts.
 * Kept here so the sentence travels with the slug it describes.
 */
export const PAGE_UNREACHABLE_LABEL =
  "The page itself: the scanner could not fetch it, so only the checks that never read a page ran";

export type TargetFailureCode =
  "unreachable" | "timeout" | "tls" | "cross_host_redirect" | "blocked";

/** Why the page could not be fetched, as stored on `result_meta.pageUnreachable`. */
export interface PageUnreachable {
  code: TargetFailureCode;
  /** A fixed sentence (the same one a failed scan of this cause shows). */
  message: string;
  /** The host a cross-host redirect pointed at, so the user can scan it instead. */
  redirectHost?: string;
}

export interface TargetFailure {
  code: TargetFailureCode;
  kind: FailureKind;
  redirectHost?: string;
}

const KIND_BY_CODE: Record<TargetFailureCode, FailureKind> = {
  unreachable: "target_unreachable",
  timeout: "target_timeout",
  tls: "target_tls",
  cross_host_redirect: "target_redirect_offhost",
  blocked: "target_blocked",
};

const FETCH_CODES: Record<string, TargetFailureCode> = {
  unreachable: "unreachable",
  timeout: "timeout",
  tls: "tls",
  cross_host_redirect: "cross_host_redirect",
  blocked: "blocked",
};

const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);

const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const TLS_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  // A TLS alert from the peer arrives as EPROTO.
  "EPROTO",
]);

/**
 * The message safeFetch has always thrown for a redirect to another host. The
 * code is the contract; this is the fallback for an error that predates it,
 * and the only message read anywhere here.
 */
const OFF_HOST_REDIRECT_MESSAGE =
  /^Redirect to a different host \(([^)]+)\) is not allowed/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * `err.code ?? err.cause?.code`, followed a few links down the cause chain:
 * undici wraps the socket error in a TypeError("fetch failed"), and a TLS
 * failure can sit one level deeper again.
 */
function errorCode(err: unknown): string | null {
  let current = asRecord(err);
  for (let depth = 0; current && depth < 4; depth++) {
    if (typeof current.code === "string" && current.code) return current.code;
    current = asRecord(current.cause);
  }
  return null;
}

function classifyCode(code: string): TargetFailureCode | null {
  const lower = FETCH_CODES[code];
  if (lower) return lower;
  if (UNREACHABLE_CODES.has(code) || code.startsWith("HPE_")) {
    return "unreachable";
  }
  if (TIMEOUT_CODES.has(code)) return "timeout";
  if (
    TLS_CODES.has(code) ||
    code.startsWith("CERT_") ||
    code.startsWith("ERR_TLS_") ||
    code.startsWith("ERR_SSL_") ||
    code.startsWith("ERR_OSSL_")
  ) {
    return "tls";
  }
  return null;
}

/**
 * Which target problem a thrown page-fetch error is, or null when it is not
 * recognisably one. Null is not "the target's fault"; it means we do not know,
 * and the caller treats an unknown throw as the engine failing, which is the
 * louder and safer reading.
 *
 * A cancel is not a target problem either, and the caller checks for it before
 * asking: an AbortError here is read as the fetch's own timeout.
 */
export function classifyTargetFailure(err: unknown): TargetFailure | null {
  const record = asRecord(err);
  const code = errorCode(err);
  let classified = code ? classifyCode(code) : null;

  let redirectHost: string | undefined;
  if (typeof record?.redirectHost === "string" && record.redirectHost) {
    redirectHost = record.redirectHost;
  }
  if (!classified && err instanceof Error) {
    const match = OFF_HOST_REDIRECT_MESSAGE.exec(err.message);
    if (match) {
      classified = "cross_host_redirect";
      redirectHost ??= match[1];
    }
  }
  if (
    !classified &&
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  ) {
    classified = "timeout";
  }
  if (!classified) return null;

  return {
    code: classified,
    kind: KIND_BY_CODE[classified],
    ...(classified === "cross_host_redirect" && redirectHost
      ? { redirectHost }
      : {}),
  };
}

/** The `result_meta.pageUnreachable` record for a classified failure. */
export function pageUnreachableFrom(failure: TargetFailure): PageUnreachable {
  return {
    code: failure.code,
    message: failureKindMessage(failure.kind),
    ...(failure.redirectHost ? { redirectHost: failure.redirectHost } : {}),
  };
}

/**
 * A target problem that leaves nothing to scan, thrown so the job's catch can
 * record it with its kind. Only `blocked` is one today: the SSRF guard refused
 * the address, and the DNS, TLS and reputation checks would be refused by the
 * same guard, so there is no useful partial scan to finish.
 */
export class ScanTargetError extends Error {
  readonly failureKind: FailureKind;
  constructor(message: string, failureKind: FailureKind) {
    super(message);
    this.name = "ScanTargetError";
    this.failureKind = failureKind;
  }
}
