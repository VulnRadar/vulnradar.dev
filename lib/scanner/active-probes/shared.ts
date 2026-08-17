/**
 * Shared infrastructure for every module in lib/scanner/active-probes/.
 *
 * These are the genuinely ACTIVE checks in this codebase: every other check
 * only reads responses, these submit real requests carrying a canary value
 * and check whether the target reflects or evaluates it. That is a
 * materially different action than the rest of the scanner, so every check
 * built on this file is opt-in only -- see lib/scanner/async-checks.ts's
 * buildBranches, which never adds the "active-probes" branch under an
 * omitted/empty `scanners` filter, only when a caller explicitly asks for it
 * by name (and, for a scan submitted by an authenticated user, only when the
 * target's domain has been verified -- see lib/domains/scope.ts).
 *
 * Form-submitting probes restrict submission to the scanned URL's own
 * hostname via safeFetch's `allowedHostnames`: a form whose `action` points
 * at a different host (a Stripe/Mailchimp embed, an OAuth provider, etc.) is
 * never probed, which also keeps the SSRF/target-pinning behavior every
 * other check in this codebase relies on.
 *
 * Every exported probe accepts an optional `cancelSignal` (see
 * getCancelSignal in scan-jobs.ts): checked between requests so a cancelled
 * scan stops queuing new payload requests, and combined into each request's
 * own AbortSignal (probeSignal below) so cancellation aborts a request
 * already in flight too. Submitting real requests to someone else's site is
 * exactly the behavior a cancelled scan must be able to stop immediately,
 * not just eventually.
 */

import { findAllForms } from "../auth/form-parser";
import { safeFetch, validateScanTarget } from "../safe-fetch";
import { generateId } from "../_helpers";
import { getCheckDef } from "../registry";
import type { Vulnerability, Category } from "../types";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { CONFIG_SCANNER_ACTIVE_PROBE_MAX_FORMS } from "@/lib/config/config-values";

export const REQUEST_TIMEOUT_MS = 6000;
/** Caps total requests a form-submitting probe makes per scan (1 page fetch
 *  + up to this many form submissions), so a page with dozens of forms
 *  can't blow the scan's time budget or hammer the target. NOT
 *  admin-configurable (see NEVER_CONFIGURABLE in lib/config/registry.ts):
 *  these are the only checks that submit real writes to the target, and
 *  raising it directly increases live traffic sent to someone else's site. */
export const MAX_FORMS_TO_PROBE = CONFIG_SCANNER_ACTIVE_PROBE_MAX_FORMS;

export const USER_AGENT = `${APP_NAME}/1.0 (Security Scanner; Active Probe; +${APP_URL})`;

export function buildFinding(
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

/**
 * Combine this probe's own per-request timeout with the scan's cancellation
 * signal (see getCancelSignal in scan-jobs.ts), when one was given. safeFetch
 * would combine a caller signal with its own internal timeout regardless, but
 * doing it here too means a cancelled scan aborts the in-flight request the
 * instant cancellation is requested, not merely by the time the fetch's own
 * timeout would have fired anyway.
 */
export function probeSignal(cancelSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return cancelSignal
    ? AbortSignal.any([timeoutSignal, cancelSignal])
    : timeoutSignal;
}

export function buildProbeRequest(
  action: string,
  method: "GET" | "POST",
  hiddenFields: Record<string, string>,
  testableFields: string[],
  marker: string,
  cancelSignal?: AbortSignal,
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
        signal: probeSignal(cancelSignal),
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
      signal: probeSignal(cancelSignal),
    },
  };
}

export interface ProbableForm {
  hostname: string;
  forms: ReturnType<typeof findAllForms>;
  /** The unprobed page's own HTML, before any payload was submitted --
   *  lets a probe distinguish "the target's response CONTAINS this text
   *  because our payload provoked it" from "this text was already on the
   *  page regardless" (a database/dev-tooling docs page or Q&A thread
   *  quoting a real error message as an example). */
  baselineHtml: string;
}

/**
 * Shared prefix every form-submitting probe needs: confirm the target is
 * safe to hit, fetch the page once, and find every form with at least one
 * testable field (capped at MAX_FORMS_TO_PROBE). Returns null on any
 * failure so each probe can fail open with a one-line check.
 */
export async function discoverProbableForms(
  url: string,
  cancelSignal?: AbortSignal,
): Promise<ProbableForm | null> {
  if (cancelSignal?.aborted) return null;

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
        signal: probeSignal(cancelSignal),
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

  return { hostname, forms, baselineHtml: html };
}
