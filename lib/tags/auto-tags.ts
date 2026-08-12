/**
 * Auto tags: short, human-readable labels derived deterministically from a
 * scan's own findings, in the spirit of a malware sandbox auto-tagging a
 * sample from its behavioral detections (e.g. app.any.run's "Stealer" /
 * "Discord Injector" labels) -- except every rule here is a plain lookup
 * against a finding's category/CWE/severity, not a model. Computed once at
 * scan-completion time (see the callers below) and saved to `scan_tags`
 * with `source = 'auto'`, alongside whatever free-form tags a user adds
 * with `source = 'user'` via app/api/v3/scan/tags/route.ts, and whatever
 * lib/ai/auto-tag-suggest.ts generates with `source = 'ai'` for the rare
 * scan that has real findings but matches none of the rules below (see
 * that module's own comment, and the "Needs Hardening" holistic tag below).
 *
 * TAXONOMY
 * --------
 * Grounded in what lib/scanner/registry.ts's check set actually reports,
 * not invented categories. Three holistic tags come from the shape of the
 * whole findings array, not any specific rule below:
 *   - "Clean": zero findings, OR every finding present is info-severity
 *     with none matching a specific rule below. Info findings are, by this
 *     taxonomy's own definition, not vulnerabilities: nothing about them is
 *     actually actionable ("we literally can't fix" a fact like "TLS 1.3
 *     not supported"), so a scan whose only findings are info notes reads
 *     the same as spotless, not as needing work.
 *   - "Critical Exposure": at least one critical-severity finding, whatever
 *     it is -- a coarse, always-relevant signal that survives even for a
 *     critical finding no specific rule below happens to cover.
 *   - "Needs Hardening": there's at least one finding at low/medium/high
 *     severity, but none qualified for any rule below (e.g. a scan with
 *     only low-severity header nitpicks -- real, worth fixing, but not
 *     severe or specific enough for any single-concept tag). Without this,
 *     a scan like that silently gets zero tags, which reads identically to
 *     "the feature is broken" even though it's working as designed -- a
 *     scan is either spotless, on fire, has some real findings, or has
 *     nothing but info-level notes, and every scan should land in one of
 *     those four buckets. This is also the exact trigger condition
 *     lib/ai/auto-tag-suggest.ts's caller looks for to fire an AI call: it
 *     only runs when computeAutoTags produced literally nothing but this
 *     fallback, i.e. every rule below was checked and missed AND at least
 *     one finding was above info severity.
 *
 * Everything else comes from AUTO_TAG_RULES, matched primarily by CWE (a
 * finding's `cwe` field, present on ~80% of the 708 checks in
 * lib/scanner/checks-data/*.json as of this taxonomy's last count) since a
 * single security concept like XSS or CORS misconfiguration spans several
 * `Category` values (content, code, client-side, headers, ...) and a
 * category-only match would miss most of it. `categories` is used as a
 * second, OR'd signal for concepts that map cleanly onto one whole category
 * (secrets-extended, information-disclosure, cookies, supply-chain, email,
 * vibe-code) -- except "Missing Security Headers", whose `requireBoth` flag
 * narrows CWE-693 to only the headers category (see that rule's own
 * comment for why). The exact CWE ids and their real distribution across
 * categories/severities in this codebase (as of this taxonomy's last count,
 * via a one-off analysis of every lib/scanner/checks-data/*.json entry) are
 * recorded next to each rule below.
 *
 * `minSeverity` exists because most of these CWEs also cover low/info
 * findings that aren't worth a chip (e.g. CWE-200 "Information Exposure"
 * fires on 76 checks, 40 of them low-severity header omissions) -- the
 * threshold keeps a tag meaning "this is worth a second look," not "this
 * concept appears anywhere in the report at all."
 *
 * WHY SO MANY RULES, AND WHY SOME ARE THIN
 * -----------------------------------------
 * This taxonomy deliberately favors many narrow, specific tags over a few
 * broad ones -- e.g. "Cleartext Transmission" / "Weak TLS Cipher Suite" /
 * "Certificate Validation Issues" / "Weak Encryption Strength" instead of
 * one catch-all "Weak TLS" tag, because a chip that says exactly which of
 * those four a scan has is more actionable than one that means "something
 * about TLS is wrong." Splitting a rule never removes detection coverage:
 * OR semantics mean a finding can still (and often does) qualify for more
 * than one tag, and MAX_AUTO_TAGS below is what keeps the chip row from
 * growing unbounded on a heavily-flagged scan.
 *
 * A handful of rules below are backed by only 1-2 checks in the current
 * checkset (e.g. "Directory Listing Enabled", "Host Header Injection",
 * "LDAP Injection Risk", "Default Credentials"). Each of those is still
 * kept as its own rule rather than folded into a generic bucket because it
 * names a single, widely-recognized vulnerability class on its own (the
 * same reasoning the original taxonomy already applied to "SQL Injection
 * Risk", backed by only 8 checks, and "CSRF Risk", backed by 6) -- a
 * precise, if infrequent, tag beats a vague, frequent one. None of these
 * are invented: every CWE id and check count below was read directly off
 * lib/scanner/checks-data/*.json, the same way the original rules were.
 */

import type { Pool, PoolClient } from "pg";
import type { Category, Severity, Vulnerability } from "@/lib/scanner/types";
import pool from "@/lib/database/db";
import { APP_NAME } from "@/lib/config/constants";

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

interface AutoTagRule {
  tag: string;
  /** CWE ids (e.g. "CWE-79") that qualify a finding, OR'd with `categories`. */
  cwes?: readonly string[];
  /** Categories that qualify a finding, OR'd with `cwes` unless `requireBoth`. */
  categories?: readonly Category[];
  /**
   * When both `cwes` and `categories` are set, require BOTH to match on the
   * same finding (AND) instead of either alone (OR, the default). Needed
   * for a CWE that is broad/shared across categories (e.g. CWE-693
   * "Protection Mechanism Failure" also shows up under client-side and
   * configuration checks, not just headers) where the tag should only mean
   * "this CWE, in this specific category" -- OR semantics would let an
   * unrelated category's finding trigger a tag named after the narrow one.
   */
  requireBoth?: boolean;
  /** A finding must be at least this severe to count towards the rule. */
  minSeverity: Severity;
  /** Qualifying findings required for the tag to apply. Defaults to 1. */
  minCount?: number;
}

// Ordered roughly by how actionable/severe the concept is -- also the
// priority order MAX_AUTO_TAGS trims from when a scan matches more rules
// than that cap, so the most important tags survive the cut.
const AUTO_TAG_RULES: readonly AutoTagRule[] = [
  {
    // CWE-798 "Use of Hard-coded Credentials" (74 checks, 51 of them in
    // secrets-extended), CWE-312 "Cleartext Storage of Sensitive
    // Information" (10), CWE-538 "Insertion of Sensitive Information into
    // Externally-Accessible File" (8, e.g. .env / lockfile exposure).
    // `categories` catches the rest of secrets-extended that predates a
    // CWE tag.
    tag: "Secrets Exposed",
    cwes: ["CWE-798", "CWE-312", "CWE-538"],
    categories: ["secrets-extended"],
    minSeverity: "medium",
  },

  // ── Server-side injection: split from the old single "Injection Risk"
  // rule into 4 tags, one per CWE, so a scan says which class of injection
  // it actually has instead of a generic "injection" label. ────────────
  {
    // CWE-78 "OS Command Injection" -- 7 checks, all in code, spread
    // critical3/high3/medium1.
    tag: "Command Injection Risk",
    cwes: ["CWE-78"],
    minSeverity: "medium",
  },
  {
    // CWE-90 "LDAP Injection" -- only 1 check (code/ldap-injection-
    // indicators, high), but a distinct, widely-recognized injection class
    // sibling to SQL Injection Risk below, not folded into anything else.
    tag: "LDAP Injection Risk",
    cwes: ["CWE-90"],
    minSeverity: "high",
  },
  {
    // CWE-89 "SQL Injection" -- only 8 checks, but every one is a strong
    // signal (4 critical, 3 high, 1 medium in this codebase).
    tag: "SQL Injection Risk",
    cwes: ["CWE-89"],
    minSeverity: "medium",
  },
  {
    // CWE-94 "Code Injection" -- 12 checks (client-side1/code10/
    // vibe-code1), critical5/high5/medium2. Distinct from CWE-78 (OS
    // command) and CWE-1336 (template injection) below even though all
    // three end in arbitrary execution.
    tag: "Code Injection Risk",
    cwes: ["CWE-94"],
    minSeverity: "medium",
  },
  {
    // CWE-1336 "Improper Neutralization of Special Elements in a Template
    // Engine" (SSTI) -- 2 checks (code/ssti-indicators, vibe-code/
    // vibe-template-injection), both high.
    tag: "Template Injection Risk",
    cwes: ["CWE-1336"],
    minSeverity: "high",
  },
  {
    // CWE-611 "XML External Entity Reference" -- 8 checks (api3/code3/
    // content2), critical2/high3/medium2/info1.
    tag: "XXE Risk",
    cwes: ["CWE-611"],
    minSeverity: "medium",
  },
  {
    // CWE-502 "Deserialization of Untrusted Data" -- 9 checks (code8/
    // vibe-code1), critical7/high2. Every instance in this checkset is
    // already high+, so the threshold changes nothing today but guards
    // against a future lower-severity addition diluting the tag.
    tag: "Insecure Deserialization",
    cwes: ["CWE-502"],
    minSeverity: "high",
  },
  {
    // CWE-22 "Path Traversal" -- 3 checks (code2/vibe-code1),
    // critical1/high2.
    tag: "Path Traversal Risk",
    cwes: ["CWE-22"],
    minSeverity: "high",
  },
  {
    // CWE-1392 "Use of Default Credentials" -- 1 check (code/
    // default-credentials, high). A single check, but a well-known and
    // unambiguous finding in its own right.
    tag: "Default Credentials",
    cwes: ["CWE-1392"],
    minSeverity: "high",
  },
  {
    // CWE-347 "Improper Verification of Cryptographic Signature" -- 4
    // checks (api1/code2/vibe-code1), ALL critical: a JWT verifier
    // accepting alg=none, jwt.verify() called with no secret, or algorithm
    // confusion. Every instance is auth-bypass-grade.
    tag: "JWT Signature Bypass",
    cwes: ["CWE-347"],
    minSeverity: "high",
  },
  {
    // CWE-79 "Cross-site Scripting" -- 36 checks across content/code/
    // client-side/vibe-code. High+ only: 12 of the 36 are medium-severity
    // (harder-to-confirm reflected cases) that don't warrant the label on
    // their own.
    tag: "XSS Risk",
    cwes: ["CWE-79"],
    minSeverity: "high",
  },
  {
    // CWE-1321 "Improperly Controlled Modification of Object Prototype
    // Attributes" (prototype pollution) -- 9 checks (client-side1/code7/
    // vibe-code1), high5/medium3/low1. Medium+ excludes the one low check
    // (spread-into-globals, the weakest of the sinks this covers).
    tag: "Prototype Pollution Risk",
    cwes: ["CWE-1321"],
    minSeverity: "medium",
  },
  {
    // CWE-915 "Improperly Controlled Modification of Dynamically-
    // Determined Object Attributes" (mass assignment) -- only 2 checks
    // (api/api-rest-mass-assignment-risk, low; vibe-code/vibe-mass-
    // assignment, high). High-only means only the vibe-code instance
    // qualifies today, same thin-but-real pattern as SQL Injection Risk.
    tag: "Mass Assignment Risk",
    cwes: ["CWE-915"],
    minSeverity: "high",
  },
  {
    // CWE-284 "Improper Access Control" (7 checks: S3/Azure blob upload
    // with no ACL restriction, Spring Boot H2 console or phpMyAdmin login
    // reachable, HTTP method override, an overly broad cookie domain),
    // CWE-862 "Missing Authorization" (2 checks: REST PUT/PATCH allowed
    // with no auth check), CWE-602 "Client-Side Enforcement of Server-Side
    // Security" (1 check: a UI-only role gate). Three different CWEs, one
    // underlying failure -- something that should require a real
    // authorization check doesn't have one. High+ keeps this to the 6
    // checks that are actually high/critical (CWE-284's info/medium
    // entries and CWE-602's single low check don't qualify).
    tag: "Broken Access Control",
    cwes: ["CWE-284", "CWE-862", "CWE-602"],
    minSeverity: "high",
  },
  {
    // CWE-287 "Improper Authentication" -- 2 checks (api/openapi-
    // security-scheme-weak, code/insecure-auth), both high.
    tag: "Weak Authentication",
    cwes: ["CWE-287"],
    minSeverity: "high",
  },
  {
    // CWE-639 "Authorization Bypass Through User-Controlled Key" (IDOR)
    // -- 1 check (host-validation/idor-sequential-id-in-url, medium).
    tag: "IDOR Risk",
    cwes: ["CWE-639"],
    minSeverity: "medium",
  },
  {
    // CWE-444 "Inconsistent Interpretation of HTTP Requests" (request
    // smuggling) -- 2 checks (host-validation/http-request-smuggling,
    // host-validation/cache-poisoning-unkeyed-header), both high.
    tag: "Request Smuggling Risk",
    cwes: ["CWE-444"],
    minSeverity: "high",
  },
  {
    // CWE-644 "Improper Neutralization of HTTP Headers for Scripting
    // Syntax" -- 1 check (host-validation/host-header-injection, high).
    tag: "Host Header Injection",
    cwes: ["CWE-644"],
    minSeverity: "high",
  },
  {
    tag: "SSRF Risk",
    cwes: ["CWE-918"],
    minSeverity: "medium",
  },

  // ── CORS: split from the old combined "CORS Misconfigured" rule --
  // CWE-942 and CWE-346 are related but distinct failure modes. ─────────
  {
    // CWE-942 "Permissive Cross-domain Policy" -- 9 checks (headers8/
    // vibe-code1), critical1/high3/medium4/low1.
    tag: "Overly Permissive CORS",
    cwes: ["CWE-942"],
    minSeverity: "medium",
  },
  {
    // CWE-346 "Origin Validation Error" -- 7 checks (api1/client-side1/
    // code1/content4), high5/medium2.
    tag: "Origin Validation Error",
    cwes: ["CWE-346"],
    minSeverity: "medium",
  },
  {
    tag: "Clickjacking Risk",
    cwes: ["CWE-1021"],
    minSeverity: "medium",
  },
  {
    tag: "CSRF Risk",
    cwes: ["CWE-352"],
    minSeverity: "medium",
  },
  {
    tag: "Open Redirect",
    cwes: ["CWE-601"],
    minSeverity: "medium",
  },
  {
    // CWE-1022 "Use of Web Link to Untrusted Target with window.opener
    // Access" (reverse tabnabbing) -- 4 checks (code2/content1/headers1),
    // high1/medium2/low1. Medium+ excludes the single low check (headers/
    // target-blank-no-noopener).
    tag: "Tabnabbing Risk",
    cwes: ["CWE-1022"],
    minSeverity: "medium",
  },
  {
    // CWE-434 "Unrestricted Upload of File with Dangerous Type" -- 2
    // checks (content/file-upload-no-restrictions, medium; vibe-code/
    // vibe-unrestricted-file-upload, high).
    tag: "Unrestricted File Upload",
    cwes: ["CWE-434"],
    minSeverity: "medium",
  },
  {
    // CWE-208 "Observable Timing Discrepancy" -- 3 checks (code2/
    // vibe-code1): non-constant-time signature/HMAC comparisons that leak
    // a byte-by-byte oracle. high2/medium1.
    tag: "Timing Attack Risk",
    cwes: ["CWE-208"],
    minSeverity: "medium",
  },

  // ── TLS/crypto: split from the old combined "Weak TLS" rule into 4
  // tags, one per failure mode, since "something about TLS is wrong" is
  // far less actionable than which of these it is. Every (none)-cwe or
  // CWE-284 finding the old category-only OR used to catch in the ssl/tls
  // categories is low/info severity in this checkset (e.g. Expect-CT
  // missing, HPKP present, TLS 1.3 not supported, CT log submission), so
  // dropping the category fallback loses no medium+ coverage in practice.
  // ─────────────────────────────────────────────────────────────────────
  {
    // CWE-319 "Cleartext Transmission of Sensitive Information" -- 23
    // checks across code/content/email/headers/host-validation/ssl/
    // supply-chain, critical2/high9/medium7/info3/low2.
    tag: "Cleartext Transmission",
    cwes: ["CWE-319"],
    minSeverity: "medium",
  },
  {
    // CWE-327 "Use of a Broken or Risky Cryptographic Algorithm" -- 9
    // checks (code1/content1/tls6/vibe-code1): RC4/3DES/NULL/EXPORT/
    // anonymous-DH cipher suites and SHA-1 certificate signatures.
    // critical4/high4/medium1 -- every instance already clears medium.
    tag: "Weak TLS Cipher Suite",
    cwes: ["CWE-327"],
    minSeverity: "medium",
  },
  {
    // CWE-295 "Improper Certificate Validation" (6 checks: dns2/tls3/
    // vibe-code1, high4/medium1/info1) + CWE-298 "Improper Validation of
    // Certificate Expiration" (2 checks, both tls, high). Deliberately
    // does NOT include CWE-299 "Improper Check for Certificate
    // Revocation" (OCSP stapling / must-staple, 2 checks, both info) --
    // both of those are informational-only in this checkset and would
    // never clear high anyway. High+ keeps this to self-signed/expired/
    // wrong-SAN/wrong-key-usage certs, the instances worth a chip.
    tag: "Certificate Validation Issues",
    cwes: ["CWE-295", "CWE-298"],
    minSeverity: "high",
  },
  {
    // CWE-326 "Inadequate Encryption Strength" -- 6 checks (api1/code1/
    // headers1/tls3): weak TLS protocol version (TLS 1.0/1.1), RSA/ECDSA
    // key size below the modern floor. critical1/high3/medium1/info1.
    tag: "Weak Encryption Strength",
    cwes: ["CWE-326"],
    minSeverity: "medium",
  },
  {
    // CWE-350 "Reliance on Reverse DNS Resolution for a Security-Critical
    // Action" -- in this checkset's actual usage, every one of the 4
    // checks (content/subdomain-takeover-fingerprint, dns/dns-dangling-
    // cname, dns/dns-dangling-cname-cdn-paas, dns/dns-dangling-cname-saas)
    // is a dangling-DNS-record subdomain takeover signal, all high.
    tag: "Subdomain Takeover Risk",
    cwes: ["CWE-350"],
    minSeverity: "high",
  },

  {
    // CWE-489 "Active Debug Code" -- debug endpoints/tokens left reachable.
    tag: "Debug Mode Exposed",
    cwes: ["CWE-489"],
    minSeverity: "medium",
  },

  // ── Cookies: split from the old combined "Weak Cookie Security" rule,
  // plus one new CWE (missing HttpOnly) the old rule never named. ───────
  {
    // CWE-614 "Sensitive Cookie Without 'Secure' Attribute" -- 14 checks
    // (code3/cookies6/headers2/information-disclosure3), high5/medium6/
    // low2/info1. Medium+ excludes the low/info entries.
    tag: "Cookie Missing Secure Flag",
    cwes: ["CWE-614"],
    minSeverity: "medium",
  },
  {
    // CWE-1004 "Sensitive Cookie Without 'HttpOnly' Flag" -- 4 checks
    // (code1/cookies2/information-disclosure1), high1/medium3. Not
    // covered by the old taxonomy at all.
    tag: "Cookie Missing HttpOnly",
    cwes: ["CWE-1004"],
    minSeverity: "medium",
  },
  {
    // CWE-1275 "Sensitive Cookie with Improper SameSite Attribute" -- 8
    // checks (code2/configuration1/cookies5), high3/medium2/low3.
    // Medium+ excludes the 3 low entries.
    tag: "Cookie Missing SameSite",
    cwes: ["CWE-1275"],
    minSeverity: "medium",
  },
  {
    // CWE-548 "Exposure of Information Through Directory Listing" -- 1
    // check (content/directory-listing, high).
    tag: "Directory Listing Enabled",
    cwes: ["CWE-548"],
    minSeverity: "high",
  },
  {
    // CWE-598 "Use of GET Request Method With Sensitive Query Strings"
    // -- 9 checks (api1/client-side1/content7), critical2/high5/medium2.
    tag: "Sensitive Data in URL",
    cwes: ["CWE-598"],
    minSeverity: "medium",
  },
  {
    // CWE-522 "Insufficiently Protected Credentials" -- 2 checks
    // (content/token-exposure, content/bearer-token-exposed), both high:
    // an auth token or bearer token left sitting in page source.
    tag: "Exposed Auth Tokens",
    cwes: ["CWE-522"],
    minSeverity: "high",
  },
  {
    // CWE-200 "Exposure of Sensitive Information to an Unauthorized
    // Actor" (76 checks, most-shared CWE in the checkset, 40 of them
    // low-severity header omissions that don't warrant the label alone)
    // + CWE-204 "Observable Response Discrepancy" (1 check: content/
    // email-enumeration, medium). `categories` catches the rest of
    // information-disclosure that predates a CWE tag or covers a concept
    // (e.g. CWE-1004/CWE-489/CWE-615, each already their own tag above/
    // below) that overlaps this category without being this exact CWE.
    tag: "Info Disclosure",
    cwes: ["CWE-200", "CWE-204"],
    categories: ["information-disclosure"],
    minSeverity: "medium",
  },
  {
    // CWE-209 "Generation of Error Message Containing Sensitive
    // Information" -- 23 checks (api1/content9/information-disclosure12/
    // vibe-code1), critical1/high5/medium16/low1. Split out of the old
    // combined "Info Disclosure" rule since a stack trace in an error page
    // is a different fix than a generally-overshared response field.
    tag: "Verbose Error Messages",
    cwes: ["CWE-209"],
    minSeverity: "medium",
  },
  {
    // CWE-615 "Inclusion of Sensitive Information in Source Code
    // Comments" -- 4 checks (content2/information-disclosure1/
    // vibe-code1), high1/medium3.
    tag: "Sensitive Comments Exposed",
    cwes: ["CWE-615"],
    minSeverity: "medium",
  },
  {
    // CWE-540 "Inclusion of Sensitive Information in Source Code" -- 2
    // checks (client-side/source-map-exposed-production, medium;
    // content/sourcemap-reference, low). Medium+ keeps this to a live
    // production source map, not a mere reference to one.
    tag: "Exposed Source Maps",
    cwes: ["CWE-540"],
    minSeverity: "medium",
  },
  {
    // CWE-693 "Protection Mechanism Failure" -- 57 checks, 54 of them
    // header-category (missing CSP/HSTS/X-Frame-Options/etc), but the
    // other 3 are client-side/configuration checks unrelated to a missing
    // HTTP header. requireBoth keeps this tag meaning exactly "a
    // CWE-693 finding filed under the headers category," not "CWE-693
    // anywhere."
    tag: "Missing Security Headers",
    cwes: ["CWE-693"],
    categories: ["headers"],
    requireBoth: true,
    minSeverity: "medium",
  },
  {
    // CWE-353 "Missing Support for Integrity Check" (Subresource
    // Integrity) -- 4 checks (client-side1/headers2/supply-chain1),
    // medium3/low1. Medium+ excludes the plain "sri-missing" low check,
    // keeping the stylesheet/third-party-script/CDN-script instances.
    tag: "Missing Subresource Integrity",
    cwes: ["CWE-353"],
    minSeverity: "medium",
  },
  {
    // CWE-799 "Improper Control of Interaction Frequency" (no rate
    // limiting) -- 6 checks (api4/configuration1/vibe-code1), high1/
    // medium5.
    tag: "Missing Rate Limiting",
    cwes: ["CWE-799"],
    minSeverity: "medium",
  },
  {
    // CWE-521 "Weak Password Requirements" -- 3 checks (content2/
    // vibe-code1), medium2/low1. Medium+ excludes the "paste disabled on
    // password field" low check, which is a different (UX) anti-pattern.
    tag: "Weak Password Policy",
    cwes: ["CWE-521"],
    minSeverity: "medium",
  },
  {
    // No dominant single CWE (lockfiles, Dockerfiles, .env files, SRI-less
    // CDN scripts), plus CWE-829 "Inclusion of Functionality from
    // Untrusted Control Sphere" (1 check: content/script-loaded-from-raw-
    // ip, high) -- a script tag pointed at a raw IP instead of a trusted
    // origin is the same "can this dependency be trusted" concern this
    // category already covers, just filed under `content` instead of
    // `supply-chain`.
    tag: "Supply Chain Exposure",
    cwes: ["CWE-829"],
    categories: ["supply-chain"],
    minSeverity: "medium",
  },
  {
    // Missing/misconfigured SPF, DKIM, DMARC, MTA-STS -- lets someone spoof
    // mail from this domain. High+ only: the email category also has a lot
    // of low-severity reporting-address nitpicks (e.g. DMARC ruf= missing).
    tag: "Email Spoofing Risk",
    categories: ["email"],
    minSeverity: "high",
  },
  {
    // lib/scanner/checks-data/vibe-code.json: patterns an AI coding
    // assistant tends to leave behind -- named here only as prose
    // describing what that scanner category detects in a *target* site's
    // response body, never executed by this codebase: use of the eval()
    // function, disabled TLS verification, Math.random() for tokens,
    // hardcoded credentials in auth logic, and similar.
    tag: "Vibe-Code Smells",
    categories: ["vibe-code"],
    minSeverity: "medium",
  },
];

/**
 * Every tag name computeAutoTags can produce without a promoted rule:
 * the two holistic tags plus every hardcoded AUTO_TAG_RULES entry above.
 * Exported so the promotion route (app/api/v3/admin/engine-feedback/
 * ai-tag-candidates/route.ts) can reject a new promoted rule whose tag
 * collides with one of these before it ever reaches computeAutoTags --
 * see that function's own dedupe comment for what happens if a collision
 * gets through anyway (deduped there too, but this is the earlier,
 * clearer place to catch it: at the moment an admin creates it, not
 * silently on whatever scan happens to trip both rules first).
 */
export const RESERVED_AUTO_TAG_NAMES: ReadonlySet<string> = new Set(
  [
    "Critical Exposure",
    "Clean",
    "Needs Hardening",
    ...AUTO_TAG_RULES.map((r) => r.tag),
  ].map((t) => t.toLowerCase()),
);

/**
 * Chip-row cap, not a policy limit (unlike MAX_TAGS_PER_SCAN, which is
 * admin-configurable): keeps a heavily-flagged scan's auto-tag row
 * scannable at a glance instead of listing every matched rule. Rules are
 * evaluated in AUTO_TAG_RULES' own priority order, so the cap trims the
 * least important matches first. The two holistic tags never count against
 * it in a way that could push them out -- they're computed and kept before
 * the per-rule matches are added.
 */
const MAX_AUTO_TAGS = 6;

function findingQualifies(finding: Vulnerability, rule: AutoTagRule): boolean {
  const matchesCwe =
    Boolean(finding.cwe) && (rule.cwes?.includes(finding.cwe!) ?? false);
  const matchesCategory = rule.categories?.includes(finding.category) ?? false;
  const matchesSignal = rule.requireBoth
    ? matchesCwe && matchesCategory
    : matchesCwe || matchesCategory;
  if (!matchesSignal) return false;
  return SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[rule.minSeverity];
}

/**
 * Pure function: derives the auto-tag set for one scan's findings. No I/O,
 * so this is the unit to test the taxonomy against directly.
 *
 * `extraRules` is how admin-promoted rules (see loadPromotedRules below)
 * get merged in without this function itself doing any I/O: the hardcoded
 * AUTO_TAG_RULES above is always evaluated first (the fast, code-reviewed
 * baseline, and the one that wins MAX_AUTO_TAGS' priority trim), then
 * `extraRules` in the order given -- same evaluation logic
 * (findingQualifies doesn't know or care which array a rule came from).
 */
export function computeAutoTags(
  findings: Vulnerability[],
  extraRules: readonly AutoTagRule[] = [],
): string[] {
  if (findings.length === 0) return ["Clean"];

  const tags: string[] = [];

  if (findings.some((f) => f.severity === "critical")) {
    tags.push("Critical Exposure");
  }

  for (const rule of extraRules.length
    ? [...AUTO_TAG_RULES, ...extraRules]
    : AUTO_TAG_RULES) {
    const count = findings.filter((f) => findingQualifies(f, rule)).length;
    if (count >= (rule.minCount ?? 1)) tags.push(rule.tag);
  }

  // Info findings aren't fixable action items (that's the whole point of
  // the info severity level), so a scan whose only unmatched findings are
  // info-severity reads as Clean, not as needing hardening. This is also
  // why maybeSuggestAiTag never fires an AI call for these scans: its
  // trigger condition is `tags === ["Needs Hardening"]` exactly, which this
  // branch never produces.
  if (tags.length === 0) {
    tags.push(
      findings.every((f) => f.severity === "info")
        ? "Clean"
        : "Needs Hardening",
    );
  }

  // Dedupe before the cap: an admin-promoted rule (see loadPromotedRules
  // below) isn't code-reviewed the way AUTO_TAG_RULES is, so its tag
  // string can legitimately collide with a hardcoded rule's tag or with
  // "Critical Exposure" above (the promotion route validates against this
  // up front, but this is the backstop for whatever that validation
  // misses, now or later). Without dedupe here, a collision would count
  // twice against MAX_AUTO_TAGS, show as a duplicate chip, and build a
  // scan_tags INSERT with two VALUES rows for the same (scan_id, tag) --
  // Postgres rejects that outright ("ON CONFLICT DO NOTHING command
  // cannot affect row a second time"), aborting the whole transaction
  // saveAutoTags shares with the scan's own completion UPDATE (see that
  // function's comment), silently leaving the scan stuck at
  // pending/running forever with its real results discarded.
  return [...new Set(tags)].slice(0, MAX_AUTO_TAGS);
}

/**
 * Admin-promoted rules (Admin > Engine Feedback > AI Tag Candidates,
 * app/api/v3/admin/engine-feedback/promoted-tags/route.ts), stored in
 * `promoted_auto_tag_rules`. This is the other half of the "AI generates a
 * tag, and the system learns which ones keep recurring so an admin can
 * promote them" design: once promoted, a concept stops costing an AI call
 * per scan and becomes a normal, fast, free, deterministic rule, merged
 * into AUTO_TAG_RULES above at evaluation time via computeAutoTags'
 * `extraRules` parameter.
 *
 * Cached in-process for DB_RULES_CACHE_TTL_MS rather than queried on every
 * single scan's tag computation -- this table is expected to stay small (a
 * handful to a few dozen admin-reviewed rows), so a short TTL cache is
 * simpler and cheap enough here rather than something more elaborate (e.g.
 * a pub/sub invalidation channel), matching this module's existing "keep
 * it simple" bar. invalidatePromotedRulesCache lets the promotion route
 * force an immediate refresh right after an INSERT so a newly promoted
 * rule takes effect on the very next scan instead of waiting out the TTL.
 */
const DB_RULES_CACHE_TTL_MS = 5 * 60 * 1000;
let dbRulesCache: { rules: AutoTagRule[]; loadedAt: number } | null = null;

interface PromotedAutoTagRuleRow {
  tag: string;
  cwes: string[] | null;
  categories: string[] | null;
  require_both: boolean;
  min_severity: Severity;
  min_count: number | null;
}

async function loadPromotedRules(): Promise<AutoTagRule[]> {
  const now = Date.now();
  if (dbRulesCache && now - dbRulesCache.loadedAt < DB_RULES_CACHE_TTL_MS) {
    return dbRulesCache.rules;
  }
  try {
    const result = await pool.query<PromotedAutoTagRuleRow>(
      `SELECT tag, cwes, categories, require_both, min_severity, min_count
       FROM promoted_auto_tag_rules
       ORDER BY created_at ASC`,
    );
    const rules: AutoTagRule[] = result.rows.map((row) => ({
      tag: row.tag,
      cwes: row.cwes ?? undefined,
      categories: (row.categories as Category[] | null) ?? undefined,
      requireBoth: row.require_both,
      minSeverity: row.min_severity,
      minCount: row.min_count ?? undefined,
    }));
    dbRulesCache = { rules, loadedAt: now };
    return rules;
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to load promoted auto-tag rules (non-fatal, falling back to hardcoded rules only):`,
      err instanceof Error ? err.message : err,
    );
    // Serve the last good cache over a transient DB hiccup rather than
    // silently dropping every promoted rule for one bad request.
    return dbRulesCache?.rules ?? [];
  }
}

/** Forces the next loadPromotedRules() call to hit the DB instead of the cache. Called by the promotion API route right after it inserts a new row. */
export function invalidatePromotedRulesCache(): void {
  dbRulesCache = null;
}

/**
 * Compute and persist a scan's auto tags. Safe to call unawaited (never
 * throws -- logs and swallows, matching upsertHostReputation's contract in
 * lib/scanner/host-reputation.ts) or to await directly when the caller
 * wants the write to land before it responds. Returns the tags it computed
 * (and attempted to save) so a caller can decide whether to also kick off
 * maybeSuggestAiTag below -- returned even if the INSERT itself failed,
 * since the taxonomy match already happened regardless of whether the
 * write landed.
 *
 * `executor` defaults to the shared pool (every fire-and-forget caller:
 * app/api/v3/scan/authenticated/route.ts, app/api/v3/scan/bulk/route.ts).
 * lib/scanner/scan-jobs.ts's finalizeScanSuccess instead passes the SAME
 * transactional PoolClient it uses for the status-flip UPDATE, so this
 * INSERT commits atomically with that UPDATE -- two separate autocommitted
 * pool.query() calls (the previous approach) left a real, if narrow,
 * window where the status UPDATE had already committed and was visible to
 * a polling GET /api/v3/scan/status/[id] request before this INSERT had,
 * so a poll landing in that gap saw status='completed' with no tags yet
 * and never polled again. Sharing one transaction closes that window: no
 * other connection sees the status flip until this insert has committed
 * too, whichever order the two statements run in.
 *
 * The promoted-rules lookup below always goes through the plain shared
 * `pool`, never `executor` -- it's a read-only, cached lookup against a
 * small, independent table, not part of the atomicity guarantee the
 * status-flip/tags INSERT pair above needs, so there is no reason to run
 * it on the same transactional client (or block that transaction any
 * longer than the cache-miss case already does, at most once per
 * DB_RULES_CACHE_TTL_MS across the whole process).
 *
 * Insert-only, not an upsert/resync: a given scanId only ever reaches
 * "completed" once (a rescan creates a new scan_history row), so there is
 * nothing to reconcile against on a second call. `ON CONFLICT DO NOTHING`
 * still guards the rare double-call (e.g. a retried request) from erroring
 * on the UNIQUE(scan_id, tag) constraint.
 */
export async function saveAutoTags(
  scanId: number,
  userId: number,
  findings: Vulnerability[],
  executor: Pool | PoolClient = pool,
): Promise<string[]> {
  const extraRules = await loadPromotedRules();
  // computeAutoTags always returns at least one tag ("Clean", "Needs
  // Hardening", or a real rule match) -- this length check is just a
  // defensive guard against a future taxonomy change, not a case that
  // fires today.
  const tags = computeAutoTags(findings, extraRules);
  if (tags.length === 0) return tags;

  const values: string[] = [];
  const params: unknown[] = [];
  tags.forEach((tag, i) => {
    const offset = i * 3;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, 'auto')`);
    params.push(scanId, userId, tag);
  });

  try {
    await executor.query(
      `INSERT INTO scan_tags (scan_id, user_id, tag, source)
       VALUES ${values.join(", ")}
       ON CONFLICT (scan_id, tag) DO NOTHING`,
      params,
    );
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to save auto tags (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }

  return tags;
}

/**
 * The AI half of the layered auto-tag design (see lib/ai/auto-tag-
 * suggest.ts's own header comment for the full rationale). Every caller of
 * saveAutoTags above calls this immediately after, passing the tags
 * saveAutoTags just returned:
 *   - lib/scanner/scan-jobs.ts's finalizeScanSuccess calls it AFTER the
 *     transaction has committed and the client released -- never inside
 *     the transaction, and never awaited by the response the client polls
 *     for, matching the constraint that deterministic tag-saving (and scan
 *     completion itself) must never wait on an AI call.
 *   - app/api/v3/scan/bulk/route.ts and app/api/v3/scan/authenticated/
 *     route.ts chain it onto saveAutoTags' own (already fire-and-forget)
 *     promise, since by the time that promise resolves the scan_history
 *     row those routes write is already a complete, committed INSERT (they
 *     write the whole row in one INSERT, not a pending-then-completed
 *     status flip the way the job-based scan/crawl routes do).
 *
 * No-ops immediately unless `tags` is EXACTLY ["Needs Hardening"] -- the
 * one shape that means "computeAutoTags matched nothing at all" (a scan
 * that's Clean or has a Critical Exposure already got a real tag, and any
 * scan that matched a specific rule doesn't need an AI guess). Never
 * throws or surfaces an error: same silent-failure contract as
 * saveAutoTags and generateAutoTagSuggestions itself.
 *
 * Saved with `source = 'ai'`, coexisting alongside the "Needs Hardening"
 * `source = 'auto'` row rather than replacing it -- deleting and
 * re-inserting would race whatever is concurrently reading this scan's
 * tags (the status-poll route, the history page) for no real benefit:
 * "Needs Hardening" is still an accurate, if generic, description of the
 * scan, and a UI showing both a generic and a specific chip side by side
 * is normal, not a bug (the same OR-based "a scan can carry more than one
 * true tag" model AUTO_TAG_RULES already uses throughout this file).
 */
export async function maybeSuggestAiTag(
  scanId: number,
  userId: number,
  tags: string[],
  findings: Vulnerability[],
): Promise<void> {
  if (tags.length !== 1 || tags[0] !== "Needs Hardening") return;

  try {
    const { generateAutoTagSuggestions } =
      await import("@/lib/ai/auto-tag-suggest");
    const suggestions = await generateAutoTagSuggestions(findings, userId);
    if (suggestions.length === 0) return;

    const values: string[] = [];
    const params: unknown[] = [];
    suggestions.forEach((tag, i) => {
      const offset = i * 3;
      values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, 'ai')`);
      params.push(scanId, userId, tag);
    });

    await pool.query(
      `INSERT INTO scan_tags (scan_id, user_id, tag, source)
       VALUES ${values.join(", ")}
       ON CONFLICT (scan_id, tag) DO NOTHING`,
      params,
    );
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to generate/save AI tag suggestion (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}
