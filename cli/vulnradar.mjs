#!/usr/bin/env node
// VulnRadar CLI: run a scan and gate on the findings, the same flow as the
// GitHub Action and the GitLab CI template, but from your shell or any CI.
// No dependencies: global fetch is all it needs. Node 22+, matching the rest
// of the project. It used to advertise Node 18, which went end of life in
// April 2025 and is exercised by nothing here.

import { parseArgs, evaluateGate, USAGE } from "./lib.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Progress and summary lines, which are for a human to read.
 *
 * With --json these go to stderr, so stdout carries the JSON document and
 * nothing else. They used to go to stdout unconditionally, wrapping the JSON
 * in a "Started scan ..." line above and a "Scan complete: ..." line below,
 * which made `vulnradar scan <url> --json | jq .` fail on the CLI's only
 * machine-readable output mode. The tell was in this repo already:
 * cli/vulnradar.test.mjs could not JSON.parse stdout and had to cut the
 * document out by index.
 */
let jsonMode = false;
const say = (msg) => (jsonMode ? console.error(msg) : console.log(msg));

/** How long any single request may take, independent of the overall budget. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How many polls in a row may fail before the run gives up.
 *
 * Not one. A default scan polls roughly sixty times and a crawl closer to two
 * hundred, so treating a single 502 from a proxy as fatal failed builds for
 * scans that were succeeding: the pipeline went red and the result landed in
 * the user's history anyway.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

/** The overall budget ran out mid-request. */
class DeadlineError extends Error {}

/** A failure worth retrying rather than reporting. */
class TransientError extends Error {}

/** A fetch rejection, said in words rather than as a bare TypeError. */
function describeFetchError(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return "the request timed out";
  }
  if (err instanceof TransientError) return err.message;
  const cause = err?.cause?.code;
  if (cause) return `${cause} (network error)`;
  return err?.message || String(err);
}

/** At most a couple of lines of a response body, for an error message. */
async function readBodyForError(res) {
  try {
    const text = await res.text();
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > 200 ? `${flat.slice(0, 200)}...` : flat;
  } catch {
    return "(no body)";
  }
}

/**
 * Parse a response that is supposed to be JSON.
 *
 * `.json()` on its own reported a captive portal or a WAF challenge page as
 * `Unexpected token '<', "<!doctype "... is not valid JSON`, with no status,
 * no URL and nothing to suggest the server had returned HTML. That is the
 * most likely real-world failure of all, so it gets a real message.
 */
async function readJson(opts, res, target) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const flat = text.replace(/\s+/g, " ").trim().slice(0, 200);
    fail(
      opts,
      `${target} returned HTTP ${res.status} with a body that is not JSON: ${flat || "(empty)"}`,
      { status: res.status },
    );
  }
}

/**
 * Report a fatal error and exit 1.
 *
 * In --json mode this writes a JSON document to stdout as well, because the
 * whole point of that mode is a pipeline: `vulnradar scan $URL --json | jq
 * '.summary.critical'` used to get an empty stdin on every failure path, and
 * jq exits 0 on empty input, so without `set -o pipefail` the shell reported
 * the pipeline as passing. The exit code, which is the CLI's entire reason to
 * exist in CI, was being thrown away exactly when it mattered.
 */
function fail(opts, message, extra = {}) {
  if (opts?.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: message, ...extra })}\n`,
    );
  }
  console.error(message);
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  jsonMode = opts.json === true;

  // Errors first. `vulnradar --typo` sets opts.error AND leaves command
  // undefined, and checking the help branch first printed bare usage with
  // nothing to say the flag had been rejected.
  if (opts.error) {
    console.error(`Error: ${opts.error}\n`);
    console.error(USAGE);
    process.exit(1);
  }
  if (opts.help || !opts.command) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 1);
  }
  if (opts.command !== "scan") {
    console.error(`Unknown command: ${opts.command}. Did you mean "scan"?`);
    process.exit(1);
  }
  if (!opts.url) {
    console.error("Error: a URL to scan is required.\n");
    console.error(USAGE);
    process.exit(1);
  }
  if (!opts.apiKey) {
    console.error(
      "Error: no API key. Pass --api-key or set VULNRADAR_TOKEN. Get one at Settings > API Keys.",
    );
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    "Content-Type": "application/json",
  };
  const endpoint = `${opts.apiBase}/scan${opts.crawl ? "/crawl" : ""}`;

  const deadline = Date.now() + opts.timeout * 1000;

  /**
   * Fetch, bounded by the deadline the caller asked for.
   *
   * Neither request carried an AbortSignal, so `--timeout` only decided how
   * often the loop below re-read the clock: a connection that was accepted
   * and never answered was never interrupted, and the process sat there until
   * the CI runner's own timeout killed the whole job. Bounding each request by
   * the time left is what makes the flag mean what it says.
   */
  const fetchBounded = (target, init) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DeadlineError();
    return fetch(target, {
      ...init,
      signal: AbortSignal.timeout(Math.min(remaining, REQUEST_TIMEOUT_MS)),
    });
  };

  // 1. Start the scan (returns a scanId; findings arrive via status polling).
  let createRes;
  try {
    createRes = await fetchBounded(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: opts.url }),
    });
  } catch (err) {
    fail(opts, `Could not reach ${endpoint}: ${describeFetchError(err)}`);
  }
  if (!createRes.ok) {
    fail(
      opts,
      `Failed to start scan (HTTP ${createRes.status}): ${await readBodyForError(createRes)}`,
      { status: createRes.status },
    );
  }
  const created = await readJson(opts, createRes, endpoint);
  const scanId = created.scanId;
  if (!scanId) fail(opts, "No scanId in the response.");
  say(`Started scan ${scanId} for ${opts.url}`);

  // 2. Poll until it completes.
  const statusUrl = `${opts.apiBase}/scan/status/${scanId}`;
  let result = null;
  let consecutiveFailures = 0;
  while (Date.now() < deadline) {
    let body;
    try {
      const statusRes = await fetchBounded(statusUrl, { headers });
      if (!statusRes.ok) {
        // 401 and 403 will not fix themselves: the key is wrong or the scan
        // is not this caller's. Anything else is worth another try.
        if (statusRes.status === 401 || statusRes.status === 403) {
          fail(
            opts,
            `Not authorized to read scan ${scanId} (HTTP ${statusRes.status}).`,
            { scanId, status: statusRes.status },
          );
        }
        throw new TransientError(`HTTP ${statusRes.status}`);
      }
      body = await statusRes.json();
    } catch (err) {
      if (err instanceof DeadlineError) break;
      // A default scan polls roughly sixty times and a crawl closer to two
      // hundred, so one blip from a proxy or a load balancer used to fail a
      // build for a scan that was succeeding: the run went red while the
      // result landed in the user's history. Transient means transient.
      consecutiveFailures += 1;
      if (consecutiveFailures > MAX_CONSECUTIVE_POLL_FAILURES) {
        fail(
          opts,
          `Lost contact with the API while polling scan ${scanId}: ${describeFetchError(err)}`,
          { scanId },
        );
      }
      say(
        `Status poll failed (${describeFetchError(err)}); retrying (${consecutiveFailures}/${MAX_CONSECUTIVE_POLL_FAILURES}).`,
      );
      await sleep(opts.pollInterval * 1000);
      continue;
    }
    consecutiveFailures = 0;
    if (body.status === "completed") {
      result = body.result;
      break;
    }
    if (body.status === "failed") {
      fail(opts, `Scan failed: ${body.error || "unknown error"}`, { scanId });
    }
    await sleep(opts.pollInterval * 1000);
  }
  if (!result) {
    fail(opts, `Timed out after ${opts.timeout}s waiting for scan ${scanId}.`, {
      scanId,
    });
  }

  // 3. Report and gate.
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  }
  const s = result.summary || {};
  say(
    `Scan complete: critical=${s.critical || 0} high=${s.high || 0} medium=${s.medium || 0} low=${s.low || 0} total=${s.total || 0}`,
  );

  const { failed, reasons } = evaluateGate(s, {
    maxCritical: opts.maxCritical,
    maxHigh: opts.maxHigh,
    maxMedium: opts.maxMedium,
  });
  if (failed) {
    for (const r of reasons) console.error(r);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err?.message || err}`);
  process.exit(1);
});
