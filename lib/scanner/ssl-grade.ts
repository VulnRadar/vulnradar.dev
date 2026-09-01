// ════════════════════════════════════════════════════════════════════════════
// SSL/TLS LETTER GRADE
//
// A self-contained, pure scorer that turns the raw signals a single TLS
// handshake exposes (negotiated protocol, key strength, cipher, and the
// certificate's trust state) into an SSL-Labs-style letter: A+, A, B, C, D, F.
// It mirrors the style of lib/scanner/safety-rating.ts -- transparent,
// documented, unit-testable, no I/O.
//
// Two independent mechanisms combine into the final grade:
//
//   1. A numeric score (0-100) that starts at 100 and takes deductions for
//      weaknesses, then maps to a letter by threshold.
//   2. A hard "cap" letter that certain conditions clamp the grade to, no
//      matter how high the numeric score is (an untrusted certificate is an F
//      regardless of how modern its cipher suite is).
//
// The final grade is the WORSE of the two.
//
// Grading rules (all derived from signals a TLS socket already gives us):
//
//   Certificate trust (hard caps):
//     - expired leaf / expired cert in chain / self-signed / hostname
//       mismatch / missing SAN / otherwise-untrusted  => F (browsers block).
//     - incomplete chain (missing intermediates)       => cap C, -25.
//   Protocol floor:
//     - server's best is below TLS 1.2 (SSLv3/TLS 1.0/TLS 1.1) => cap F, -55.
//     - TLS 1.2 (no TLS 1.3)                                   => cap A.
//     - TLS 1.3                                                => A+ eligible.
//   Key strength:
//     - RSA  < 1024 bits => cap F, -70;  1024..2047 => cap B, -40.
//     - EC curve below P-256 => cap B, -20.
//   Cipher:
//     - RC4 / DES / 3DES / NULL / EXPORT / anon / MD5 => cap C, -40.
//     - CBC-mode (legacy but not broken)              => -5.
//   Small extras (only nudge the numeric score, never lift a cap):
//     - certificate expiring within 14 days => -5.
//     - OCSP stapling enabled                => +3.
//     - HSTS enabled                         => +3.
//
// The grade is only meaningful when TLS was actually reached. An HTTP-only or
// unreachable target returns null (not "F"), so a site that simply has no
// HTTPS on the probed path is never mislabeled as having a failing certificate.
// ════════════════════════════════════════════════════════════════════════════

import {
  CONFIG_SSL_GRADE_A_PLUS_MIN_SCORE,
  CONFIG_SSL_GRADE_A_MIN_SCORE,
  CONFIG_SSL_GRADE_B_MIN_SCORE,
  CONFIG_SSL_GRADE_C_MIN_SCORE,
  CONFIG_SSL_GRADE_D_MIN_SCORE,
} from "@/lib/config/config-values";

export interface SslGradeInput {
  /** Was a TLS handshake actually completed? If false, there is no grade. */
  reachedTls: boolean;
  /** Negotiated protocol from socket.getProtocol(), e.g. "TLSv1.3". */
  protocol: string | null;
  /** socket.authorized: did the cert validate against the trust store? */
  authorized: boolean;
  /** Leaf certificate has expired (CERT_HAS_EXPIRED). */
  certExpired?: boolean;
  /** An intermediate/root in the chain has expired. */
  chainHasExpiredCert?: boolean;
  /** Self-signed leaf or self-signed cert in the chain. */
  certSelfSigned?: boolean;
  /** Certificate does not cover the requested hostname (ERR_TLS_CERT_ALTNAME_INVALID). */
  hostnameMismatch?: boolean;
  /** Leaf could not be chained to a trusted root (UNABLE_TO_VERIFY_LEAF_SIGNATURE). */
  incompleteChain?: boolean;
  /** Certificate has no Subject Alternative Name extension (rejected by modern clients). */
  missingSan?: boolean;
  /** Public key size in bits (cert.bits). For EC keys this is the curve size, see isEcKey. */
  keyBits?: number;
  /** True when the certificate uses an elliptic-curve key rather than RSA. */
  isEcKey?: boolean;
  /** NIST curve name for an EC key, e.g. "P-256". */
  nistCurve?: string;
  /** Negotiated cipher suite name from socket.getCipher().name. */
  cipherName?: string;
  /** Days until the leaf certificate expires (negative if already expired). */
  daysUntilExpiry?: number;
  /** OCSP stapling observed (optional bonus; often not measured here). */
  ocspStapled?: boolean;
  /** HSTS response header present (optional bonus; often not measured here). */
  hstsEnabled?: boolean;
}

export interface SslGradeResult {
  grade: string;
  score: number;
  reasons: string[];
}

// Best (index 0) to worst. `worse` picks the higher index.
const LETTERS = ["A+", "A", "B", "C", "D", "F"] as const;
type Letter = (typeof LETTERS)[number];

const rankOf = (l: Letter): number => LETTERS.indexOf(l);
const worse = (a: Letter, b: Letter): Letter =>
  rankOf(a) >= rankOf(b) ? a : b;

const STRONG_CURVES = ["P-256", "P-384", "P-521"];
const WEAK_CIPHER_TOKENS = ["RC4", "DES", "NULL", "EXPORT", "ANON", "MD5"];

/**
 * Compute an SSL/TLS letter grade from a single handshake's signals.
 * Returns null when TLS was never reached (so we grade only real HTTPS).
 */
export function computeSslGrade(input: SslGradeInput): SslGradeResult | null {
  if (!input.reachedTls) return null;

  const reasons: string[] = [];
  let score = 100;
  let cap: Letter = "A+";

  // ── Certificate trust: the strongest signal, applied first ──────────────
  // Any of these makes a browser refuse or warn, so the grade is F outright
  // no matter how modern the rest of the configuration is.
  if (input.certExpired) {
    reasons.push("Certificate has expired");
    return { grade: "F", score: 0, reasons };
  }
  if (input.chainHasExpiredCert) {
    reasons.push(
      "An intermediate or root certificate in the chain has expired",
    );
    return { grade: "F", score: 0, reasons };
  }
  if (input.certSelfSigned) {
    reasons.push("Self-signed certificate, not trusted by browsers");
    return { grade: "F", score: 0, reasons };
  }
  if (input.hostnameMismatch) {
    reasons.push("Certificate does not match the requested hostname");
    return { grade: "F", score: 0, reasons };
  }
  if (input.missingSan) {
    reasons.push("Certificate is missing a Subject Alternative Name");
    return { grade: "F", score: 0, reasons };
  }
  if (!input.authorized && !input.incompleteChain) {
    // Untrusted for a reason not classified above; browsers would warn.
    reasons.push("Certificate is not trusted");
    return { grade: "F", score: 0, reasons };
  }
  if (input.incompleteChain) {
    // Works in browsers that fetch missing intermediates via AIA, but fails
    // strict TLS clients, so it caps the grade rather than failing it.
    cap = worse(cap, "C");
    score -= 25;
    reasons.push("Incomplete certificate chain (missing intermediates)");
  }

  // ── Protocol ────────────────────────────────────────────────────────────
  const proto = input.protocol ?? "";
  if (proto === "TLSv1.3") {
    reasons.push("TLS 1.3 supported");
  } else if (proto === "TLSv1.2") {
    cap = worse(cap, "A");
    reasons.push("TLS 1.3 not supported (server's best is TLS 1.2)");
  } else if (
    proto === "TLSv1.1" ||
    proto === "TLSv1" ||
    proto === "SSLv3" ||
    proto === "SSLv2"
  ) {
    score -= 55;
    cap = worse(cap, "F");
    reasons.push(`Obsolete protocol ${proto}: no TLS 1.2 or higher`);
  } else {
    score -= 10;
    reasons.push("Negotiated protocol could not be determined");
  }

  // ── Key strength ────────────────────────────────────────────────────────
  if (input.isEcKey) {
    const curve = input.nistCurve ?? "";
    if (STRONG_CURVES.includes(curve)) {
      reasons.push(`Strong EC key (${curve})`);
    } else if (curve) {
      score -= 20;
      cap = worse(cap, "B");
      reasons.push(`EC curve ${curve} is below P-256`);
    } else {
      reasons.push("Elliptic-curve certificate key");
    }
  } else if (typeof input.keyBits === "number") {
    const bits = input.keyBits;
    if (bits < 1024) {
      score -= 70;
      cap = worse(cap, "F");
      reasons.push(`Very weak RSA key (${bits}-bit)`);
    } else if (bits < 2048) {
      score -= 40;
      cap = worse(cap, "B");
      reasons.push(`RSA key below 2048-bit (${bits}-bit)`);
    } else {
      reasons.push(`RSA key ${bits}-bit`);
    }
  }

  // ── Cipher ──────────────────────────────────────────────────────────────
  const cipher = (input.cipherName ?? "").toUpperCase();
  if (cipher) {
    if (WEAK_CIPHER_TOKENS.some((t) => cipher.includes(t))) {
      score -= 40;
      cap = worse(cap, "C");
      reasons.push(`Weak cipher suite (${input.cipherName})`);
    } else if (cipher.includes("CBC")) {
      score -= 5;
      reasons.push(`Legacy CBC-mode cipher (${input.cipherName})`);
    } else {
      reasons.push(`Modern cipher (${input.cipherName})`);
    }
  }

  // ── Small extras ────────────────────────────────────────────────────────
  if (
    typeof input.daysUntilExpiry === "number" &&
    input.daysUntilExpiry >= 0 &&
    input.daysUntilExpiry <= 14
  ) {
    score -= 5;
    reasons.push(`Certificate expires in ${input.daysUntilExpiry} day(s)`);
  }
  if (input.ocspStapled) {
    score += 3;
    reasons.push("OCSP stapling enabled");
  }
  if (input.hstsEnabled) {
    score += 3;
    reasons.push("HSTS enabled");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // The five cutoffs were bare literals here until AUDIT-014#magic-07. They
  // now live in lib/config/config-values.ts, the documented self-hoster edit
  // point, next to the safety-verdict thresholds they are the sibling of; see
  // the NEVER_CONFIGURABLE entries in lib/config/registry.ts for why they are
  // build-tier rather than admin-editable. Values are unchanged.
  let letter: Letter;
  if (score >= CONFIG_SSL_GRADE_A_PLUS_MIN_SCORE) letter = "A+";
  else if (score >= CONFIG_SSL_GRADE_A_MIN_SCORE) letter = "A";
  else if (score >= CONFIG_SSL_GRADE_B_MIN_SCORE) letter = "B";
  else if (score >= CONFIG_SSL_GRADE_C_MIN_SCORE) letter = "C";
  else if (score >= CONFIG_SSL_GRADE_D_MIN_SCORE) letter = "D";
  else letter = "F";

  return { grade: worse(letter, cap), score, reasons };
}

// ════════════════════════════════════════════════════════════════════════════
// PER-HOST SIDE CHANNEL
//
// checkTLSCert (lib/scanner/async-checks.ts) computes the grade where the TLS
// socket lives, but its result is flattened into a Vulnerability[] by the
// async-branch orchestration on the way back to the scan pipeline, with no
// room to carry a scalar alongside it. Rather than thread a new return type
// through every branch, checkTLSCert records the grade here keyed by hostname,
// and execute-scan.ts / execute-crawl-scan.ts read it back when they assemble
// result_meta.
//
// The grade is a property of the host's TLS endpoint, so keying by hostname is
// correct: two concurrent scans of the same host observe the same grade, and
// a crawl's many same-host pages all resolve to one entry. Reads do not delete
// (peek), so concurrent readers of one host each see the value; entries are
// pruned by TTL on write so the map can never grow unbounded.
// ════════════════════════════════════════════════════════════════════════════

const GRADE_TTL_MS = 5 * 60 * 1000;
const gradeStore = new Map<string, { grade: string; at: number }>();

function pruneGradeStore(now: number): void {
  for (const [key, entry] of gradeStore) {
    if (now - entry.at > GRADE_TTL_MS) gradeStore.delete(key);
  }
}

/** Stash a freshly computed grade for `hostname` (called from checkTLSCert). */
export function recordSslGrade(hostname: string, grade: string): void {
  const now = Date.now();
  pruneGradeStore(now);
  gradeStore.set(hostname.toLowerCase(), { grade, at: now });
}

/** Read back the grade recorded for `hostname`, or undefined if none/stale. */
export function readSslGrade(hostname: string): string | undefined {
  const entry = gradeStore.get(hostname.toLowerCase());
  if (!entry) return undefined;
  if (Date.now() - entry.at > GRADE_TTL_MS) {
    gradeStore.delete(hostname.toLowerCase());
    return undefined;
  }
  return entry.grade;
}
