import { randomBytes } from "node:crypto";
import { safeFetch } from "../safe-fetch";
import type { Vulnerability } from "../types";
import {
  buildFinding,
  buildProbeRequest,
  discoverProbableForms,
} from "./shared";

// Same "evaluated vs. literal" trick as ssti.ts's polyglot expression, aimed
// at OS command injection instead of a template engine: $(( )) is POSIX
// shell arithmetic. If the payload is only ever reflected back as literal
// text (the common false-positive case: a search box that echoes your
// query), the page shows the raw, unevaluated "$((7*13))" string. If the
// input actually reaches a shell as part of a command, the shell evaluates
// the arithmetic to 91 before the target's own output (or the target's
// reflection of that output) reaches the response -- a result that could
// not appear from copy-pasting the input verbatim.
const CMDI_A = 7;
const CMDI_B = 13;
const CMDI_PRODUCT = String(CMDI_A * CMDI_B);

function cmdiMarker(hex: string): string {
  // A leading `;` breaks out of an unquoted shell argument the target
  // builds by string concatenation (e.g. `exec("ping " + input)` via
  // `/bin/sh -c`); `echo` prints the tagged, shell-evaluated arithmetic so
  // it survives into whatever output the target reflects.
  return `;echo vr${hex}cmdi$((${CMDI_A}*${CMDI_B}))end${hex}`;
}

function cmdiEvaluatedForm(hex: string): string {
  return `vr${hex}cmdi${CMDI_PRODUCT}end${hex}`;
}

/**
 * OS command injection probe. Submits a shell metacharacter (`;`) followed
 * by an `echo` of a tagged arithmetic expression into every testable field
 * of each form, and checks whether the response contains the CALCULATED
 * result -- proof the input reached a shell and was executed, not just
 * echoed back as text. Read-only: `echo` and integer arithmetic are the only
 * things ever actually run, nothing is written, deleted, or exfiltrated.
 *
 * Same fail-open contract as checkActiveProbes.
 */
export async function checkCommandInjectionProbe(
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
    const marker = cmdiMarker(hex);

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
      if (responseText.includes(cmdiEvaluatedForm(hex))) {
        const distinguisher = `${form.action}#${formIndex}:${form.testableFields.join(",")}`;
        const finding = buildFinding(
          "os-command-injection",
          url,
          distinguisher,
          `A shell metacharacter and a tagged arithmetic expression submitted through the form at ${form.action} came back with the expression evaluated (computed result present in the response), indicating the input reaches a shell command rather than being treated as inert text.`,
          90,
          "Active canary probe (shell arithmetic evaluation, form submission)",
        );
        if (finding) findings.push(finding);
      }
    } catch {
      continue;
    }
  }

  return findings;
}
