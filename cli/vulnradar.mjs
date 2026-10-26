#!/usr/bin/env node
// VulnRadar CLI: run a scan and gate on the findings, the same flow as the
// GitHub Action and the GitLab CI template, but from your shell or any CI.
// No dependencies: global fetch is all it needs. Node 22+, matching the rest
// of the project. It used to advertise Node 18, which went end of life in
// April 2025 and is exercised by nothing here.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  parseArgs,
  evaluateGate,
  gateCounts,
  hasSummary,
  incompleteOutcome,
  describeNotChecked,
  describeProgress,
  buildScanBody,
  classifyRateLimit,
  createRetryPlan,
  retryAfterSeconds,
  reportRequestUrl,
  cancelScan,
  USAGE,
  EXIT,
} from "./lib.mjs";

/** package.json ships with every npm package, so this always resolves. */
const VERSION = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Write to stdout and wait for it to flush, so process.exit cannot cut a report short. */
const writeStdout = (text) =>
  new Promise((resolve) => process.stdout.write(text, () => resolve()));

/**
 * Whether --json was passed, which decides if a failure also writes a JSON
 * document to stdout. Module state because the last-resort handler at the
 * bottom has no access to the parsed options.
 */
let jsonMode = false;

/**
 * Whether stdout is carrying data: the JSON result, or a report with no --out.
 *
 * Progress and summary lines are for a human to read, so when stdout carries
 * data they go to stderr instead. They used to go to stdout unconditionally,
 * wrapping the JSON in a "Started scan ..." line above and a "Scan complete:
 * ..." line below, which made `vulnradar scan <url> --json | jq .` fail on the
 * CLI's only machine-readable output mode, and put two junk lines at the top
 * of `--report sarif > results.sarif`.
 */
let stdoutCarriesData = false;
const say = (msg) =>
  stdoutCarriesData ? console.error(msg) : console.log(msg);

/** The result document is on stdout, so a failure must not write a second one. */
let resultPrinted = false;

/** The scan this run started, once there is one, for the failure document. */
let activeScanId = null;

/** How long any single request may take, independent of the overall budget. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How long the one status poll after the deadline may take. Shorter than a
 * normal request so that a server that has stopped answering costs the run
 * seconds past its timeout, not half a minute.
 */
const FINAL_POLL_TIMEOUT_MS = 10_000;

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

/** A couple of lines of a body, flattened, for an error message. */
function snippetOf(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}...` : flat;
}

/**
 * A failed response, read once: a snippet for the message, and the parsed
 * body when it was JSON so the caller can look at its `statusCode`.
 */
async function readErrorBody(res) {
  let text;
  try {
    text = await res.text();
  } catch {
    return { snippet: "(no body)", json: null, statusCode: undefined };
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const statusCode =
    json && typeof json.statusCode === "string" ? json.statusCode : undefined;
  return { snippet: snippetOf(text), json, statusCode };
}

/**
 * Parse a response that is supposed to be JSON.
 *
 * `.json()` on its own reported a captive portal or a WAF challenge page as
 * `Unexpected token '<', "<!doctype "... is not valid JSON`, with no status,
 * no URL and nothing to suggest the server had returned HTML. That is the
 * most likely real-world failure of all, so it gets a real message.
 */
async function readJson(res, target) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    fail(
      `${target} returned HTTP ${res.status} with a body that is not JSON: ${snippetOf(text) || "(empty)"}`,
      { status: res.status },
    );
  }
}

/**
 * A status poll's body, which has to be a JSON object. Anything else is a
 * transient failure with the same words `readJson` uses, so a proxy's HTML
 * error page is described rather than reported as a parser message.
 */
function parsePollBody(text, status) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new TransientError(
      `HTTP ${status} with a body that is not JSON: ${snippetOf(text) || "(empty)"}`,
    );
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new TransientError(
      `HTTP ${status} with a body that is not a JSON object: ${snippetOf(text)}`,
    );
  }
  return body;
}

/**
 * Report a fatal error and exit EXIT.ERROR.
 *
 * In --json mode this writes a JSON document to stdout as well, because the
 * whole point of that mode is a pipeline: `vulnradar scan $URL --json | jq
 * '.summary.critical'` used to get an empty stdin on every failure path, and
 * jq exits 0 on empty input, so without `set -o pipefail` the shell reported
 * the pipeline as passing. The exit code, which is the CLI's entire reason to
 * exist in CI, was being thrown away exactly when it mattered.
 *
 * The document is { ok: false, error, scanId?, status?, statusCode?,
 * failureKind? }: `status` is the HTTP status, `statusCode` the API's own
 * string code, `failureKind` why a scan that started then failed. A success
 * writes the raw result, which has no `ok` key, so the exit code is the
 * success signal. Once the result is on stdout nothing more is written there:
 * two documents are not one document.
 */
function fail(message, extra = {}) {
  if (jsonMode && !resultPrinted) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: message,
        ...(activeScanId === null ? {} : { scanId: activeScanId }),
        ...extra,
      })}\n`,
    );
  }
  console.error(message);
  process.exit(EXIT.ERROR);
}

/**
 * Cancel the scan this run started if the run is killed.
 *
 * A pipeline that is cancelled, or times out at the runner, used to leave its
 * scan running and holding the account's only concurrency slot, so the re-run
 * was refused with a 429 for as long as the abandoned scan took to finish.
 * The handlers are `once`, so a second Ctrl-C while the cancel is in flight
 * gets the default action and ends the process at once.
 */
function cancelOnSignal(scanId, apiBase, headers) {
  let handling = false;
  for (const [signal, code] of [
    ["SIGINT", EXIT.SIGINT],
    ["SIGTERM", EXIT.SIGTERM],
  ]) {
    process.once(signal, async () => {
      if (handling) return;
      handling = true;
      console.error(`Received ${signal}, cancelling scan ${scanId}.`);
      const outcome = await cancelScan(apiBase, scanId, headers);
      console.error(outcome.message);
      if (jsonMode && !resultPrinted) {
        process.stdout.write(
          `${JSON.stringify({
            ok: false,
            error: `Interrupted by ${signal}. ${outcome.message}`,
            scanId,
            signal,
          })}\n`,
        );
      }
      process.exit(code);
    });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  jsonMode = opts.json === true;
  stdoutCarriesData = jsonMode || (Boolean(opts.report) && !opts.out);

  // Errors first. `vulnradar --typo` sets opts.error AND leaves command
  // undefined, and checking the help branch first printed bare usage with
  // nothing to say the flag had been rejected.
  // Every branch below routes through fail(), which is what makes --json mean
  // something on all of them. It applied to the scan paths only, so an
  // argument error wrote nothing at all to stdout and
  // `vulnradar scan $URL --json | jq -e .ok` got empty stdin - and jq exits 0
  // on empty input, so without `set -o pipefail` the shell reported the failed
  // pipeline as a pass. That is the exact bug fail() exists to close, left open
  // on the paths that never called it. (Do not gate on `.ok` for success: a
  // success document has no such key. The exit code is the signal.)
  if (opts.error) {
    console.error(USAGE);
    fail(`Error: ${opts.error}`);
  }
  if (opts.help) {
    // Asking for help and getting it is success, and it belongs on stdout.
    console.log(USAGE);
    process.exit(EXIT.OK);
  }
  if (opts.version) {
    console.log(VERSION);
    process.exit(EXIT.OK);
  }
  if (!opts.command) {
    console.error(USAGE);
    fail("Error: a command is required.");
  }
  if (opts.command !== "scan") {
    fail(`Unknown command: ${opts.command}. Did you mean "scan"?`);
  }
  if (!opts.url) {
    console.error(USAGE);
    fail("Error: a URL to scan is required.");
  }
  if (!opts.apiKey) {
    fail(
      "Error: no API key. Pass --api-key or set VULNRADAR_TOKEN. Create one under Profile > Developer > API Keys.",
    );
  }

  // Before the first request, so a path that cannot be written is found out
  // before a scan is started and charged. Only the folder is created, never
  // the file: nothing is written until there is a report to put in it.
  if (opts.out) {
    try {
      mkdirSync(dirname(opts.out), { recursive: true });
    } catch (err) {
      fail(
        `Could not create the folder for ${opts.out}: ${err?.message || err}`,
      );
    }
  }

  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    "Content-Type": "application/json",
    // Names the client in the API's logs and rate-limit records, so a CI
    // integration is distinguishable from a browser or a script.
    "User-Agent": `vulnradar-cli/${VERSION}`,
  };
  const endpoint = `${opts.apiBase}/scan${opts.crawl ? "/crawl" : ""}`;

  let deadline = Date.now() + opts.timeout * 1000;

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
  //
  // A 429 is one of three things (see classifyRateLimit). A busy slot is
  // waited out with a capped backoff, and that wait is added to the deadline
  // because it is not time spent on the scan the --timeout is about. A short
  // rate limit is retried after its Retry-After if it fits in what is left. A
  // spent daily quota is never retried: its wait is hours.
  let createRes;
  let createError = null;
  let createNote = "";
  let concurrentRetries = 0;
  let otherRetries = 0;
  let slotWaitedSeconds = 0;
  for (;;) {
    try {
      createRes = await fetchBounded(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(buildScanBody(opts)),
      });
    } catch (err) {
      fail(`Could not reach ${endpoint}: ${describeFetchError(err)}`);
    }
    if (createRes.ok) break;
    createError = await readErrorBody(createRes);
    if (createRes.status !== 429) break;

    const kind = classifyRateLimit(createRes.headers, createError.json);
    const plan = createRetryPlan({
      kind,
      retryAfter: retryAfterSeconds(createRes.headers.get("retry-after")),
      concurrentRetries,
      otherRetries,
      slotWaitedSeconds,
      secondsLeft: (deadline - Date.now()) / 1000,
    });
    if (!plan.retry) {
      createNote = plan.note;
      break;
    }
    if (plan.extendsBudget) {
      concurrentRetries += 1;
      slotWaitedSeconds += plan.wait;
      deadline += plan.wait * 1000;
      say(
        `Another scan is already running on this account; retrying in ${plan.wait}s.`,
      );
    } else {
      otherRetries += 1;
      say(`Rate limited; retrying in ${plan.wait}s.`);
    }
    await sleep(plan.wait * 1000);
  }
  if (!createRes.ok) {
    fail(
      `Failed to start scan (HTTP ${createRes.status}): ${createError.snippet}${createNote}`,
      {
        status: createRes.status,
        ...(createError.statusCode
          ? { statusCode: createError.statusCode }
          : {}),
      },
    );
  }
  const created = await readJson(createRes, endpoint);
  const scanId = created?.scanId;
  if (!scanId) fail("No scanId in the response.");
  activeScanId = scanId;
  say(`Started scan ${scanId} for ${opts.url}`);
  cancelOnSignal(scanId, opts.apiBase, headers);

  // 2. Poll until it completes.
  const statusUrl = `${opts.apiBase}/scan/status/${scanId}`;
  let result = null;
  let completed = false;
  let consecutiveFailures = 0;
  let lastProgress = "";
  // One status poll is made after the deadline passes, so a scan that
  // finished while the last sleep was running is not reported as a timeout.
  let polledPastDeadline = false;
  for (;;) {
    const pastDeadline = Date.now() >= deadline;
    if (pastDeadline) {
      if (polledPastDeadline) break;
      polledPastDeadline = true;
    }
    let body;
    try {
      const statusRes = pastDeadline
        ? await fetch(statusUrl, {
            headers,
            signal: AbortSignal.timeout(FINAL_POLL_TIMEOUT_MS),
          })
        : await fetchBounded(statusUrl, { headers });
      const text = await statusRes.text();
      if (!statusRes.ok) {
        // 401 and 403 will not fix themselves: the key is wrong or the scan
        // is not this caller's. Anything else is worth another try.
        if (statusRes.status === 401 || statusRes.status === 403) {
          fail(
            `Not authorized to read scan ${scanId} (HTTP ${statusRes.status}).`,
            { status: statusRes.status },
          );
        }
        // The API's own "Scan not found" means the scan is gone (deleted
        // while polling), not that the network blinked. A bare or HTML 404 is
        // as likely to be a gateway, so that one is still retried.
        if (statusRes.status === 404) {
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
          if (parsed?.error === "Scan not found") {
            fail(`Scan ${scanId} not found (deleted while polling?).`, {
              status: 404,
            });
          }
        }
        throw new TransientError(`HTTP ${statusRes.status}`);
      }
      body = parsePollBody(text, statusRes.status);
    } catch (err) {
      // The budget ran out between the check above and the request. The next
      // pass makes the final poll.
      if (err instanceof DeadlineError) continue;
      if (pastDeadline) break;
      // A default scan polls roughly sixty times and a crawl closer to two
      // hundred, so one blip from a proxy or a load balancer used to fail a
      // build for a scan that was succeeding: the run went red while the
      // result landed in the user's history. Transient means transient.
      consecutiveFailures += 1;
      if (consecutiveFailures > MAX_CONSECUTIVE_POLL_FAILURES) {
        fail(
          `Lost contact with the API while polling scan ${scanId}: ${describeFetchError(err)}`,
        );
      }
      say(
        `Status poll failed (${describeFetchError(err)}); retrying (${consecutiveFailures}/${MAX_CONSECUTIVE_POLL_FAILURES}).`,
      );
      await sleep(
        Math.max(0, Math.min(opts.pollInterval * 1000, deadline - Date.now())),
      );
      continue;
    }
    consecutiveFailures = 0;
    if (body.status === "completed") {
      result = body.result ?? null;
      completed = true;
      break;
    }
    if (body.status === "failed") {
      // Why it failed, when the API says (a bad certificate on the target and
      // a server restart are both "failed", and a pipeline reacts to them
      // differently). Appended last so the "Scan failed: " prefix people grep
      // for is unchanged, and an old server that sends no kind prints none.
      const kind =
        typeof body.failureKind === "string" && body.failureKind
          ? body.failureKind
          : null;
      fail(
        `Scan failed: ${body.error || "unknown error"}${kind ? ` [${kind}]` : ""}`,
        kind ? { failureKind: kind } : {},
      );
    }
    if (pastDeadline) break;
    // Said when it moves, not on every poll: a slow category must not repeat
    // itself, but a crawl that is silent for fifteen minutes looks hung.
    const progress = describeProgress(body);
    if (progress && progress !== lastProgress) {
      lastProgress = progress;
      say(progress);
    }
    // Never past the deadline: the sleep that ends exactly on it is followed
    // by the final poll, not by a wait for the next interval.
    await sleep(
      Math.max(0, Math.min(opts.pollInterval * 1000, deadline - Date.now())),
    );
  }
  if (!completed) {
    let outcome;
    if (opts.cancelOnTimeout) {
      outcome = await cancelScan(opts.apiBase, scanId, headers);
    }
    fail(
      `Timed out after ${opts.timeout}s waiting for scan ${scanId}. ${
        outcome
          ? outcome.message
          : "It is still running on the server; pass --cancel-on-timeout to cancel it when the timeout runs out."
      }`,
    );
  }
  // Fail closed. A missing summary read as zeros would pass a response the
  // CLI did not understand, and a gate that cannot judge must not pass.
  if (!hasSummary(result)) {
    fail(
      `Scan ${scanId} completed but its result has no summary object, so the thresholds cannot be judged.`,
    );
  }

  // 3. Report what was found and what was not looked at.
  const counts = gateCounts(result, {
    includeSuppressed: opts.includeSuppressed,
  });
  const incomplete = incompleteOutcome(result, opts);
  if (opts.json) {
    await writeStdout(`${JSON.stringify(result, null, 2)}\n`);
    resultPrinted = true;
  }
  say(
    `Scan complete: critical=${counts.critical} high=${counts.high} medium=${counts.medium} low=${counts.low} total=${counts.total}`,
  );
  if (counts.suppressed > 0) {
    say(
      `${counts.suppressed} suppressed by false-positive verdicts, not counted (--include-suppressed counts them).`,
    );
  }
  // Always, to stderr, and whether or not the run fails on it: a passing gate
  // that never saw the page, or skipped DNS, has to say so.
  for (const line of describeNotChecked(incomplete)) console.error(line);

  // 4. Download the report, if one was asked for.
  //
  // Before the gate, deliberately. A pipeline that fails the build on a new
  // critical is exactly the pipeline that wants the SARIF it was going to
  // upload, and exiting first would leave the upload step with no file.
  //
  // A failure here is recorded and reported, never fatal on its own: the gate
  // is judged below and a failed gate still exits 1. It used to exit 2 from
  // here, which a pipeline that tolerates 2 as "VulnRadar hiccuped" (the
  // GitLab template suggests exactly that) would merge past a build with
  // criticals, and in --json mode it wrote a second document after the result.
  //
  // It also gets its own request timeout rather than what is left of
  // --timeout, which says how long to wait for the SCAN: a scan that finishes
  // one second inside the budget would otherwise have no time left to fetch
  // anything, and the run would report a failure for work that succeeded.
  let reportFailed = false;
  if (opts.report) {
    const reportError = (message) => {
      reportFailed = true;
      console.error(message);
    };
    const target = reportRequestUrl(opts.apiBase, scanId, opts);
    let bytes = null;
    try {
      const res = await fetch(target, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const { snippet } = await readErrorBody(res);
        reportError(
          `Could not download the ${opts.report} report (HTTP ${res.status}): ${snippet}`,
        );
      } else {
        bytes = Buffer.from(await res.arrayBuffer());
      }
    } catch (err) {
      reportError(
        `Could not download the ${opts.report} report: ${describeFetchError(err)}`,
      );
    }
    if (bytes) {
      if (opts.out) {
        try {
          writeFileSync(opts.out, bytes);
          say(`Wrote the ${opts.report} report to ${opts.out}.`);
        } catch (err) {
          reportError(`Could not write ${opts.out}: ${err?.message || err}`);
        }
      } else {
        const text = bytes.toString("utf8");
        await writeStdout(text.endsWith("\n") ? text : `${text}\n`);
      }
    }
  }

  // 5. Judge. A failed gate wins over everything: it is a real result.
  const { failed, reasons } = evaluateGate(counts, {
    maxCritical: opts.maxCritical,
    maxHigh: opts.maxHigh,
    maxMedium: opts.maxMedium,
  });
  if (failed) {
    for (const r of reasons) console.error(r);
    // EXIT.GATE_FAILED, not EXIT.ERROR. The scan ran and the answer was "too
    // many findings" - this is the one non-zero exit that means the tool
    // worked, and the whole reason a pipeline can act on it.
    process.exit(EXIT.GATE_FAILED);
  }
  if (incomplete.blocking) {
    console.error(
      `Exiting ${EXIT.INCOMPLETE}: the scan did not check ${incomplete.blockingAreas
        .map((a) => a.label)
        .join(
          "; ",
        )}. A pass here would mean nothing was looked at. Pass --allow-incomplete to accept a partial scan.`,
    );
    process.exit(EXIT.INCOMPLETE);
  }
  process.exit(reportFailed ? EXIT.ERROR : EXIT.OK);
}

main().catch((err) => {
  fail(`Unexpected error: ${err?.message || err}`);
});
