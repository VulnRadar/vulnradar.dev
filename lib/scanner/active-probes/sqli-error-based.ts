import { randomBytes } from "crypto";
import { safeFetch } from "../safe-fetch";
import type { Vulnerability } from "../types";
import {
  buildFinding,
  buildProbeRequest,
  discoverProbableForms,
} from "./shared";

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
  cancelSignal?: AbortSignal,
): Promise<Vulnerability[]> {
  const discovered = await discoverProbableForms(url, cancelSignal);
  if (!discovered) return [];
  const { hostname, forms, baselineHtml } = discovered;

  // A signature already present on the UNPROBED page (a database/dev-
  // tooling documentation page or Q&A thread that quotes a real SQL error
  // message as example content) would keep matching every probed response
  // too, regardless of whether the payload did anything at all. Exclude
  // those signatures up front rather than trusting a post-probe match
  // alone -- this is a cheap, no-extra-request way to approximate the
  // "confirm against a control response" check mainstream DAST tools do.
  const preExisting = new Set(
    SQL_ERROR_SIGNATURES.filter((sig) => sig.test(baselineHtml)),
  );
  const liveSignatures = SQL_ERROR_SIGNATURES.filter(
    (sig) => !preExisting.has(sig),
  );
  if (liveSignatures.length === 0) return [];

  const findings: Vulnerability[] = [];

  for (const [formIndex, form] of forms.entries()) {
    if (cancelSignal?.aborted) break;
    const hex = randomBytes(4).toString("hex");
    const payload = "vr" + hex + "'";

    try {
      const { url: probeUrl, init } = buildProbeRequest(
        form.action,
        form.method,
        form.hiddenFields,
        form.testableFields,
        payload,
        cancelSignal,
      );
      const res = await safeFetch(probeUrl, init, [hostname]);
      const responseText = await res.text();
      if (liveSignatures.some((sig) => sig.test(responseText))) {
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
