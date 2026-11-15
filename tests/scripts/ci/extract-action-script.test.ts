import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractRunBody } from "../../../scripts/ci/extract-action-script.mjs";

/**
 * scripts/ci/extract-action-script.mjs hands the scan-gate action's shell
 * script to shellcheck, which cannot read a composite action. If it extracted
 * the wrong block, or nothing, shellcheck would pass over an empty file and
 * say the script is clean.
 */

const ROOT = path.resolve(__dirname, "../../../");
const SCRIPT = path.join(ROOT, "scripts", "ci", "extract-action-script.mjs");
const ACTION = path.join(ROOT, ".github", "actions", "scan-gate", "action.yml");
const DIR = mkdtempSync(path.join(tmpdir(), "vr-extract-action-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** The same extraction tests/repo/scan-gate-parity.test.ts makes. */
function parityExtraction(source: string): string {
  const lines = source.split("\n");
  const opener = lines.findIndex((line) => /^\s+run:\s*\|\s*$/.test(line));
  const indent = (lines[opener + 1].match(/^ */) as RegExpMatchArray)[0].length;
  const body: string[] = [];
  for (const line of lines.slice(opener + 1)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if ((line.match(/^ */) as RegExpMatchArray)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return `${body.join("\n")}\n`;
}

const action = readFileSync(ACTION, "utf8");

describe("the scan-gate action's script", () => {
  const out = spawnSync(process.execPath, [SCRIPT, ACTION], {
    encoding: "utf8",
  });

  it("is printed whole, and is what the parity test reads", () => {
    expect(out.status).toBe(0);
    expect(out.stdout.trimEnd()).toBe(parityExtraction(action).trimEnd());
    expect(out.stdout).toContain("log_safe");
    expect(out.stdout).toContain('echo "::add-mask::$VR_API_KEY"');
    expect(out.stdout.length).toBeGreaterThan(3000);
  });

  it("parses as bash", () => {
    const file = path.join(DIR, "scan-gate.sh");
    writeFileSync(file, out.stdout);
    const check = spawnSync("bash", ["-n", file], { encoding: "utf8" });
    // A machine with no bash cannot run this half; CI always has it.
    if (check.error) return;
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
  });

  it("holds no workflow expression, which shellcheck would read as text", () => {
    expect(out.stdout).not.toContain("${{ inputs");
    expect(out.stdout).not.toContain("${{ steps");
  });
});

describe("extractRunBody", () => {
  const yaml = [
    "runs:",
    "  steps:",
    "    - name: first",
    "      shell: bash",
    "      run: |",
    "        echo first",
    "    - id: scan",
    "      shell: bash",
    "      env:",
    "        A: b",
    "      run: |",
    "        set -e",
    "",
    "        if true; then",
    "          echo scan",
    "        fi",
    "    - name: last",
    "      run: |",
    "        echo last",
    "",
  ].join("\n");

  it("takes the run block of the step with the id, nothing before or after", () => {
    expect(extractRunBody(yaml, "scan")).toBe(
      "set -e\n\nif true; then\n  echo scan\nfi\n",
    );
  });

  it("throws for a step that is not there", () => {
    expect(() => extractRunBody(yaml, "other")).toThrow(/no step with id/);
  });

  it("throws for a step with no literal run block", () => {
    expect(() =>
      extractRunBody("steps:\n  - id: scan\n    run: echo hi\n", "scan"),
    ).toThrow(/no run/);
  });
});
