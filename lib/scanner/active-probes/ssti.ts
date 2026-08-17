import { randomBytes } from "crypto";
import { safeFetch } from "../safe-fetch";
import type { Vulnerability } from "../types";
import {
  buildFinding,
  buildProbeRequest,
  discoverProbableForms,
} from "./shared";

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
export async function checkSstiProbe(
  url: string,
  cancelSignal?: AbortSignal,
): Promise<Vulnerability[]> {
  const discovered = await discoverProbableForms(url, cancelSignal);
  if (!discovered) return [];
  const { hostname, forms } = discovered;

  const findings: Vulnerability[] = [];

  for (const [formIndex, form] of forms.entries()) {
    if (cancelSignal?.aborted) break;
    const hex = randomBytes(4).toString("hex");
    const marker = sstiMarker(hex);

    try {
      const { url: probeUrl, init } = buildProbeRequest(
        form.action,
        form.method,
        form.hiddenFields,
        form.testableFields,
        marker,
        cancelSignal,
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
