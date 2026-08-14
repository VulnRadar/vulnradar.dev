/**
 * Reflected-input (XSS) canary probe.
 *
 * The first genuinely ACTIVE check in this codebase: every other check only
 * reads responses, this one submits real requests carrying a per-form
 * canary value and checks whether the target reflects it back unescaped.
 * That is a materially different action than the rest of the scanner, so
 * this check is opt-in only -- see lib/scanner/async-checks.ts's
 * buildBranches, which never adds the "active-probes" branch under an
 * omitted/empty `scanners` filter, only when a caller explicitly asks for
 * it by name.
 *
 * Submission is restricted to the scanned URL's own hostname via
 * safeFetch's `allowedHostnames`: a form whose `action` points at a
 * different host (a Stripe/Mailchimp embed, an OAuth provider, etc.) is
 * never probed, which also keeps the SSRF/target-pinning behavior every
 * other check in this codebase relies on.
 */

import { randomBytes } from "crypto";
import { findAllForms } from "./auth/form-parser";
import { safeFetch, validateScanTarget } from "./safe-fetch";
import { generateId } from "./_helpers";
import { getCheckDef } from "./registry";
import type { Vulnerability, Category } from "./types";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { CONFIG_SCANNER_ACTIVE_PROBE_MAX_FORMS } from "@/lib/config/config-values";

const REQUEST_TIMEOUT_MS = 6000;
/** Caps total requests this check makes per scan (1 page fetch + up to this
 *  many form submissions), so a page with dozens of forms can't blow the
 *  scan's time budget or hammer the target. NOT admin-configurable (see
 *  NEVER_CONFIGURABLE in lib/config/registry.ts): this is the only check
 *  that submits real writes to the target, and raising it directly
 *  increases live traffic sent to someone else's site. */
const MAX_FORMS_TO_PROBE = CONFIG_SCANNER_ACTIVE_PROBE_MAX_FORMS;

const USER_AGENT = `${APP_NAME}/1.0 (Security Scanner; Active Probe; +${APP_URL})`;

function buildFinding(
  checkId: string,
  url: string,
  distinguisher: string,
  evidence: string,
  confidence: number = 96,
  detectionMethod: string = "Active canary-reflection probe (form submission)",
): Vulnerability | null {
  const def = getCheckDef(checkId);
  if (!def) return null;
  return {
    id: generateId(def.id, url, distinguisher),
    title: def.title,
    severity: def.severity as Vulnerability["severity"],
    category: def.category as Category,
    description: def.description,
    evidence,
    riskImpact: def.riskImpact,
    explanation: def.explanation,
    fixSteps: def.fixSteps,
    codeExamples: def.codeExamples,
    references: def.references ?? [],
    confidence,
    detectionMethod,
    ...(def.cwe ? { cwe: def.cwe } : {}),
    ...(def.owasp ? { owasp: def.owasp } : {}),
  };
}

function buildProbeRequest(
  action: string,
  method: "GET" | "POST",
  hiddenFields: Record<string, string>,
  testableFields: string[],
  marker: string,
): { url: string; init: RequestInit } {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(hiddenFields)) {
    body.set(name, value);
  }
  for (const field of testableFields) {
    body.set(field, marker);
  }

  if (method === "GET") {
    const target = new URL(action);
    for (const [key, value] of body.entries()) {
      target.searchParams.set(key, value);
    }
    return {
      url: target.toString(),
      init: {
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    };
  }

  return {
    url: action,
    init: {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  };
}

interface ProbableForm {
  hostname: string;
  forms: ReturnType<typeof findAllForms>;
}

/**
 * Shared prefix every probe in this file needs: confirm the target is safe
 * to hit, fetch the page once, and find every form with at least one
 * testable field (capped at MAX_FORMS_TO_PROBE). Returns null on any
 * failure so each probe can fail open with a one-line check.
 */
async function discoverProbableForms(
  url: string,
): Promise<ProbableForm | null> {
  const safety = await validateScanTarget(url);
  if (!safety.safe) return null;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  let html: string;
  try {
    const res = await safeFetch(
      url,
      {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
      [hostname],
    );
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const forms = findAllForms(html, url)
    .filter((f) => f.testableFields.length > 0)
    .slice(0, MAX_FORMS_TO_PROBE);
  if (forms.length === 0) return null;

  return { hostname, forms };
}

/**
 * Fetches `url`, finds every form on the page, and submits each one (up to
 * MAX_FORMS_TO_PROBE) with a unique per-form canary value in every testable
 * field. A form is flagged when the canary comes back in the response
 * unescaped -- proof the target reflects that input without sanitizing it.
 *
 * Fails open (returns []) on any error at any stage: a missing page, an
 * unreachable target, a form whose action fails safeFetch's hostname/SSRF
 * checks, or a submission that errors out. A failure here must never crash
 * the scan or produce a false positive; the worst outcome of an outage is
 * an under-report (this form wasn't probed), never a wrong finding.
 */
export async function checkActiveProbes(url: string): Promise<Vulnerability[]> {
  const discovered = await discoverProbableForms(url);
  if (!discovered) return [];
  const { hostname, forms } = discovered;

  const findings: Vulnerability[] = [];

  for (const [formIndex, form] of forms.entries()) {
    // Unique per form: two forms flagged on the same page must not collide
    // on the literal marker one contains showing up in the other's probe.
    const canary = `vr${randomBytes(4).toString("hex")}xss`;
    const marker = `<${canary}>`;

    try {
      const { url: probeUrl, init } = buildProbeRequest(
        form.action,
        form.method,
        form.hiddenFields,
        form.testableFields,
        marker,
      );
      const res = await safeFetch(probeUrl, init, [hostname]);
      // A JSON/plaintext API response can contain the literal marker (JSON
      // string encoding doesn't escape < or >) without it ever being parsed
      // as HTML by a browser, so only treat this as confirmed reflected XSS
      // when the response is actually HTML (or the content type is unknown,
      // which we treat conservatively as possibly HTML).
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType && !/^text\/html/i.test(contentType)) {
        continue;
      }
      const responseText = await res.text();
      if (responseText.includes(marker)) {
        // form.action alone isn't a unique distinguisher: two different
        // forms on the same page (a header search box and a body search
        // form, say) can share the same action URL, which would collapse
        // both findings onto the same generateId() hash -- see _helpers.ts.
        // Folding in the form's index and field set keeps them distinct
        // even when the action and the fields are both identical.
        const distinguisher = `${form.action}#${formIndex}:${form.testableFields.join(",")}`;
        const finding = buildFinding(
          "reflected-input-xss",
          url,
          distinguisher,
          `A canary value submitted through the form at ${form.action} was reflected unescaped in the response.`,
        );
        if (finding) findings.push(finding);
      }
    } catch {
      continue; // this form's probe failed -- move on to the next candidate
    }
  }

  return findings;
}

// Common, distinctive error-message fragments a database engine emits when
// it chokes on a malformed query -- the same signature-matching approach
// every mainstream DAST tool uses for error-based SQLi detection. Deliberately
// specific enough that ordinary page copy won't false-positive on them.
const SQL_ERROR_SIGNATURES: RegExp[] = [
  /you have an error in your sql syntax/i, // MySQL
  /warning:\s*mysql_/i, // MySQL (PHP mysql_* warnings)
  /unclosed quotation mark after the character string/i, // MSSQL
  /microsoft ole db provider for sql server/i, // MSSQL
  /unrecognized token:/i, // SQLite
  /sqlite3?\.(operationalerror|programmingerror)/i, // SQLite (Python)
  /syntax error at or near/i, // PostgreSQL
  /pg_query\(\)/i, // PostgreSQL (PHP)
  /ora-\d{5}/i, // Oracle
  /valid mysql result/i,
  /postgresql query failed/i,
];

/**
 * Error-based SQL injection probe. Submits a single unescaped quote into
 * every testable field of each form and checks whether the response
 * contains a recognizable database error signature -- the target's own
 * error handler confirming the input reached a query unsanitized. This is
 * read-only: nothing is ever actually exfiltrated or modified, the only
 * "attack" is tripping the target's own error output.
 *
 * Same fail-open contract as checkActiveProbes: any error at any stage
 * returns [] rather than crashing the scan or guessing.
 */
export async function checkSqlInjectionProbe(
  url: string,
): Promise<Vulnerability[]> {
  const discovered = await discoverProbableForms(url);
  if (!discovered) return [];
  const { hostname, forms } = discovered;

  const findings: Vulnerability[] = [];

  for (const [formIndex, form] of forms.entries()) {
    const hex = randomBytes(4).toString("hex");
    const payload = "vr" + hex + "'";

    try {
      const { url: probeUrl, init } = buildProbeRequest(
        form.action,
        form.method,
        form.hiddenFields,
        form.testableFields,
        payload,
      );
      const res = await safeFetch(probeUrl, init, [hostname]);
      const responseText = await res.text();
      if (SQL_ERROR_SIGNATURES.some((sig) => sig.test(responseText))) {
        const distinguisher = `${form.action}#${formIndex}:${form.testableFields.join(",")}`;
        const finding = buildFinding(
          "sql-injection-error-based",
          url,
          distinguisher,
          `Submitting a single unescaped quote through the form at ${form.action} produced a database error in the response, indicating the input reaches a query unsanitized.`,
          85,
          "Active canary probe (error-based SQL injection, form submission)",
        );
        if (finding) findings.push(finding);
      }
    } catch {
      continue;
    }
  }

  return findings;
}

// Two literal syntaxes covering the two broad SSTI engine families: Jinja2 /
// Twig / Nunjucks ({{ }}) and FreeMarker / ERB / JSP-EL-style (${ }). A
// vulnerable engine evaluates the one it recognizes and leaves the other
// untouched as literal text, so checking for either evaluated form (with the
// per-scan hex tag on both sides) is enough to catch either family without
// guessing which templating engine the target uses.
const SSTI_A = 7;
const SSTI_B = 13;
const SSTI_PRODUCT = String(SSTI_A * SSTI_B);

function sstiMarker(hex: string): string {
  return (
    "vr" +
    hex +
    "ssti{{" +
    SSTI_A +
    "*" +
    SSTI_B +
    "}}" +
    "${" +
    SSTI_A +
    "*" +
    SSTI_B +
    "}end" +
    hex
  );
}

function sstiEvaluatedForms(hex: string): string[] {
  const prefix = "vr" + hex + "ssti";
  const suffix = "end" + hex;
  return [
    // {{ }} evaluated, ${ } left as literal text
    prefix + SSTI_PRODUCT + "${" + SSTI_A + "*" + SSTI_B + "}" + suffix,
    // ${ } evaluated, {{ }} left as literal text
    prefix + "{{" + SSTI_A + "*" + SSTI_B + "}}" + SSTI_PRODUCT + suffix,
  ];
}

/**
 * Server-Side Template Injection probe. Submits a polyglot arithmetic
 * expression (covering both {{ }} and ${ } template syntaxes) tagged with a
 * per-form random hex canary on both sides, and checks whether the response
 * contains the CALCULATED result stitched back between those exact tags --
 * proof the target evaluated the expression as template code rather than
 * treating it as inert text. The hex tag on both sides of the computed value
 * is what keeps this from false-positiving on a page that happens to contain
 * the number 91 somewhere unrelated.
 *
 * Same fail-open contract as checkActiveProbes.
 */
export async function checkSstiProbe(url: string): Promise<Vulnerability[]> {
  const discovered = await discoverProbableForms(url);
  if (!discovered) return [];
  const { hostname, forms } = discovered;

  const findings: Vulnerability[] = [];

  for (const [formIndex, form] of forms.entries()) {
    const hex = randomBytes(4).toString("hex");
    const marker = sstiMarker(hex);

    try {
      const { url: probeUrl, init } = buildProbeRequest(
        form.action,
        form.method,
        form.hiddenFields,
        form.testableFields,
        marker,
      );
      const res = await safeFetch(probeUrl, init, [hostname]);
      const responseText = await res.text();
      if (
        sstiEvaluatedForms(hex).some((evaluated) =>
          responseText.includes(evaluated),
        )
      ) {
        const distinguisher = `${form.action}#${formIndex}:${form.testableFields.join(",")}`;
        const finding = buildFinding(
          "server-side-template-injection",
          url,
          distinguisher,
          `A tagged arithmetic expression submitted through the form at ${form.action} came back evaluated (computed result present in the response), indicating the input is rendered as template code rather than inert text.`,
          92,
          "Active canary probe (arithmetic template evaluation, form submission)",
        );
        if (finding) findings.push(finding);
      }
    } catch {
      continue;
    }
  }

  return findings;
}
