#!/usr/bin/env node
// VulnRadar CLI: run a scan and gate on the findings, the same flow as the
// GitHub Action and the GitLab CI template, but from your shell or any CI.
// No dependencies: global fetch is all it needs. Node 22+, matching the rest
// of the project. It used to advertise Node 18, which went end of life in
// April 2025 and is exercised by nothing here.

import { parseArgs, evaluateGate, USAGE } from "./lib.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || !opts.command) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 1);
  }
  if (opts.error) {
    console.error(`Error: ${opts.error}\n`);
    console.error(USAGE);
    process.exit(1);
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

  // 1. Start the scan (returns a scanId; findings arrive via status polling).
  const createRes = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: opts.url }),
  });
  if (!createRes.ok) {
    console.error(
      `Failed to start scan (HTTP ${createRes.status}): ${await createRes.text()}`,
    );
    process.exit(1);
  }
  const { scanId } = await createRes.json();
  if (!scanId) {
    console.error("No scanId in the response.");
    process.exit(1);
  }
  console.log(`Started scan ${scanId} for ${opts.url}`);

  // 2. Poll until it completes.
  const deadline = Date.now() + opts.timeout * 1000;
  let result = null;
  while (Date.now() < deadline) {
    const statusRes = await fetch(`${opts.apiBase}/scan/status/${scanId}`, {
      headers,
    });
    if (!statusRes.ok) {
      console.error(
        `Failed to poll status (HTTP ${statusRes.status}): ${await statusRes.text()}`,
      );
      process.exit(1);
    }
    const body = await statusRes.json();
    if (body.status === "completed") {
      result = body.result;
      break;
    }
    if (body.status === "failed") {
      console.error(`Scan failed: ${body.error || "unknown error"}`);
      process.exit(1);
    }
    await sleep(opts.pollInterval * 1000);
  }
  if (!result) {
    console.error(
      `Timed out after ${opts.timeout}s waiting for scan ${scanId}.`,
    );
    process.exit(1);
  }

  // 3. Report and gate.
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  }
  const s = result.summary || {};
  console.log(
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
