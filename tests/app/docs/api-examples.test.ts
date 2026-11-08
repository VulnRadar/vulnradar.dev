import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("app/docs/api/page.tsx", "utf8");

/** One language's block of the codeExamples object, up to the next language. */
function sample(lang: "curl" | "javascript" | "python"): string {
  const start = page.indexOf(`  ${lang}: {\n    scan:`);
  expect(start).toBeGreaterThan(-1);
  const rest = page.slice(start + 1);
  const end = rest.search(/\n {2}(curl|javascript|python): \{|\n\};/);
  return rest.slice(0, end === -1 ? undefined : end);
}

describe("/docs/api code examples", () => {
  it("checks every JS response and stops at a deadline", () => {
    const js = sample("javascript");
    expect(js).toContain(
      "if (!started.ok) throw new Error(await started.text())",
    );
    expect(js).toContain("res.ok");
    expect(js).toContain("deadline");
    expect(js).toContain("Retry-After");
    expect(js).not.toContain("for (;;)");
    expect(js).toContain("SCANNING.TIMEOUT_SECONDS * 1000");
  });

  it("polls with a real until loop and jq in curl", () => {
    const curl = sample("curl");
    expect(curl).toContain("until [");
    expect(curl).toContain("jq -r .status");
    expect(curl).toContain("deadline");
    expect(curl).toContain("SCANNING.TIMEOUT_SECONDS");
  });

  it("makes the curl sample fail on a refused create and a failed scan", () => {
    const curl = sample("curl");
    // A pipe into jq would report jq's exit status and hide curl's.
    expect(curl).not.toContain("| jq -r .scanId");
    expect(curl).toContain('|| { echo "$started" >&2; exit 1; }');
    expect(curl).toContain('[ "$status" = completed ] || {');
    expect(page.replace(/\s+/g, " ")).toContain("needs bash and jq");
  });

  it("uses plain requests for Python, never the retired SDK", () => {
    const py = sample("python");
    expect(py).toContain("import requests");
    expect(py).toContain("time.sleep(2)");
    expect(py).toContain("deadline");
    expect(py).toContain('result["findings"]');
    // requests has no default timeout, so a hung read would outlive the deadline.
    expect(py.match(/timeout=30/g)).toHaveLength(2);
    expect(py).not.toContain("from vulnradar");
    expect(page).not.toContain("VulnRadar/Python-SDK");
    expect(page.replace(/\s+/g, " ")).toContain("targets the retired v2 API");
  });

  it("states the poll interval and that the status read costs no quota", () => {
    const flat = page.replace(/\s+/g, " ");
    expect(flat).toContain("every 2 to 5 seconds");
    expect(flat).toContain("does not consume daily quota");
  });

  it("tells readers to poll, and that failed scans fire no webhook", () => {
    const flat = page.replace(/\s+/g, " ");
    expect(flat).toContain(
      "Webhooks do not fire for failed, cancelled or timed-out scans.",
    );
    expect(flat).not.toContain("Polling /history burns quota");
  });

  it("names the real key path and button", () => {
    const flat = page.replace(/\s+/g, " ");
    expect(flat).toContain("Profile &gt; Developer &gt; API Keys");
    expect(flat).toContain("Create key");
    expect(page).not.toContain("Generate New Key");
  });

  it("keeps every section id the table of contents links to", () => {
    for (const id of [
      "code-examples",
      "best-practices",
      "ci-cd",
      "rate-limiting",
      "error-handling",
    ]) {
      expect(page).toContain(`id: "${id}"`);
      expect(page).toContain(`id="${id}"`);
    }
  });
});
