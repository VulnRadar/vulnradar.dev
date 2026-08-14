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
  formAction: string,
): Vulnerability | null {
  const def = getCheckDef(checkId);
  if (!def) return null;
  return {
    id: generateId(def.id, url, distinguisher),
    title: def.title,
    severity: def.severity as Vulnerability["severity"],
    category: def.category as Category,
    description: def.description,
    evidence: `A canary value submitted through the form at ${formAction} was reflected unescaped in the response.`,
    riskImpact: def.riskImpact,
    explanation: def.explanation,
    fixSteps: def.fixSteps,
    codeExamples: def.codeExamples,
    references: def.references ?? [],
    confidence: 96,
    detectionMethod: "Active canary-reflection probe (form submission)",
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
  const safety = await validateScanTarget(url);
  if (!safety.safe) return [];

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return [];
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
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const forms = findAllForms(html, url)
    .filter((f) => f.testableFields.length > 0)
    .slice(0, MAX_FORMS_TO_PROBE);
  if (forms.length === 0) return [];

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
          form.action,
        );
        if (finding) findings.push(finding);
      }
    } catch {
      continue; // this form's probe failed -- move on to the next candidate
    }
  }

  return findings;
}
