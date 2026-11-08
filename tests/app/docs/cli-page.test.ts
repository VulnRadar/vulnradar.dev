import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { evaluateGate } from "../../../cli/lib.mjs";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const page = read("app/docs/cli/page.tsx");
const cli = read("cli/vulnradar.mjs");

describe("the CLI page", () => {
  it("titles itself the way the docs spec words it", () => {
    expect(page).toContain('title="Command-line interface (CLI)"');
  });

  it("shows the token in the first thing a reader copies", () => {
    const install = page.slice(page.indexOf('id="install"'));
    const first = install.match(/code=\{`([^`]*)`\}/)?.[1];
    expect(first).toMatch(
      /^VULNRADAR_TOKEN=vr_live_\.\.\. npx vulnradar scan /,
    );
  });

  it("keeps the section ids the nav and other pages link to", () => {
    for (const id of [
      "overview",
      "install",
      "usage",
      "options",
      "exit-codes",
      "incomplete",
      "json",
      "limits",
      "ci",
    ]) {
      expect(page, id).toContain(`id="${id}"`);
    }
  });
});

describe("the example run", () => {
  const start = page.indexOf('id="example-run"');
  const block = page
    .slice(start)
    .match(/code=\{`([^`]*)`\}/)![1]
    .split("\n");

  it("uses the lines the CLI prints", () => {
    expect(cli).toContain("`Started scan ${scanId} for ${opts.url}`");
    expect(block).toContain("Started scan 4821 for https://example.com");
    expect(block.some((l) => l.startsWith("Scanning: "))).toBe(true);
    expect(cli).toContain(
      "`Scan complete: critical=${counts.critical} high=${counts.high} medium=${counts.medium} low=${counts.low} total=${counts.total}`",
    );
  });

  it("fails for the reason, and with the code, the gate gives", () => {
    const summary = block
      .find((l) => l.startsWith("Scan complete:"))!
      .match(/critical=(\d+) high=(\d+) medium=(\d+)/)!;
    const [, critical, high, medium] = summary.map(Number);
    const verdict = evaluateGate(
      { critical, high, medium },
      { maxCritical: 0, maxHigh: 0, maxMedium: -1 },
    );
    expect(verdict.failed).toBe(true);
    for (const reason of verdict.reasons) expect(block).toContain(reason);
    expect(block.slice(-2)).toEqual(["$ echo $?", "1"]);
  });
});

describe("the --json section", () => {
  const start = page.indexOf('id="json"');
  const section = page.slice(start, page.indexOf("</DocsSection>", start));

  it("has a jq example that keeps the exit code", () => {
    expect(section).toMatch(/--json > result\.json\nstatus=\$\?\njq -r /);
    expect(section).toContain("exit $status");
  });

  it("reads only fields a finding has", () => {
    const types = read("lib/scanner/types.ts");
    const shape = types.slice(types.indexOf("export interface Vulnerability"));
    for (const field of ["id", "title", "severity"]) {
      expect(shape).toMatch(new RegExp(`\\b${field}: `));
    }
    expect(read("cli/lib.mjs")).toContain("f.suppressed !== true");
  });
});
