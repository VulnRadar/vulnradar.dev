import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Active probes and port scans send real attack-shaped traffic, so they may
 * only ever reach a domain the requester has proven they own. The engine does
 * not check that itself: buildBranches runs whatever probes the `scanners`
 * filter names, and executeScan port-scans whenever `portScan` is true. The
 * gate lives in each route that takes a scan request (requestsActiveProbing
 * plus isUrlOwnedByUser), and the route tests prove each of those.
 *
 * What nothing proved is that there are no OTHER ways in. A new entry point,
 * say a worker that replays a saved scan with its original scanner list,
 * would fire probes at whatever URL it was handed and every existing test
 * would still pass. This walks every production call into the engine and
 * fails when one forwards a scanner list or a port scan without the file
 * also running the ownership gate. Passing null, undefined or false is the
 * safe answer and needs no gate, which is what bulk, scheduled and demo scans
 * do.
 */

const ROOTS = ["app", "lib"];

// Engine internals that forward their own caller's value rather than
// deciding one. Their callers are what this test checks.
const FORWARDERS = new Set([
  "lib/scanner/async-checks.ts",
  "lib/scanner/execute-scan.ts",
  "lib/scanner/execute-crawl-scan.ts",
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path.replace(/\\/g, "/"));
    }
  }
  return out;
}

/** The text between the call's parentheses, found by bracket depth. */
function callArguments(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i++) {
    const c = source[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return source.slice(openParen + 1);
}

/** Split top-level arguments on commas outside any bracket. */
function topLevelParts(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = args.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

/** The value of `key` in an object literal argument, or undefined when the
 *  object does not set it. Shorthand `key,` returns the key itself. */
function propertyValue(objectArg: string, key: string): string | undefined {
  const body = objectArg.trim().replace(/^\{/, "").replace(/\}$/, "");
  for (const part of topLevelParts(body)) {
    if (part === key) return key;
    const m = part.match(/^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/);
    if (m && m[1] === key) return m[2].trim();
  }
  return undefined;
}

const SAFE_SCANNERS = /^(null|undefined)$/;
const SAFE_PORT_SCAN = /^(false|undefined)$/;

interface EngineCall {
  file: string;
  entry: string;
  scanners: string | undefined;
  portScan: string | undefined;
}

function engineCalls(): EngineCall[] {
  const calls: EngineCall[] = [];
  const files = ROOTS.flatMap(sourceFiles).filter((f) => !FORWARDERS.has(f));
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(
      /\b(executeScan|executeCrawlScan|runAsyncChecksDetailed|runAsyncChecks)\(/g,
    )) {
      // A declaration or a docstring mention, not a call.
      const before = source.slice(Math.max(0, m.index - 20), m.index);
      if (/function\s+$/.test(before)) continue;
      const lineStart = source.lastIndexOf("\n", m.index) + 1;
      if (/^\s*(\*|\/\/)/.test(source.slice(lineStart, m.index))) continue;

      const args = callArguments(source, m.index + m[1].length);
      const entry = m[1];
      if (entry === "executeScan" || entry === "executeCrawlScan") {
        const object = topLevelParts(args)[0] ?? "";
        calls.push({
          file,
          entry,
          scanners: propertyValue(
            object,
            entry === "executeScan" ? "selectedScanners" : "scanners",
          ),
          portScan: propertyValue(object, "portScan"),
        });
      } else {
        calls.push({
          file,
          entry,
          scanners: topLevelParts(args)[1],
          portScan: undefined,
        });
      }
    }
  }
  return calls;
}

describe("active probes and port scans only reach an owned domain", () => {
  const calls = engineCalls();

  it("finds the engine's entry points", () => {
    // The three scan routes, bulk, scheduled and demo scans. If this drops,
    // the parser stopped seeing calls, and the checks below prove nothing.
    expect(calls.length).toBeGreaterThanOrEqual(6);
    const files = new Set(calls.map((c) => c.file));
    expect(files).toContain("app/api/v3/scan/route.ts");
    expect(files).toContain("app/api/v3/scan/crawl/route.ts");
    expect(files).toContain("app/api/v3/scan/authenticated/route.ts");
  });

  for (const call of calls) {
    const source = readFileSync(call.file, "utf8");
    const forwardsScanners =
      call.scanners !== undefined && !SAFE_SCANNERS.test(call.scanners);
    const forwardsPortScan =
      call.portScan !== undefined && !SAFE_PORT_SCAN.test(call.portScan);
    if (!forwardsScanners && !forwardsPortScan) continue;

    it(`${call.file} gates ${call.entry} on domain ownership`, () => {
      expect(
        source.includes("isUrlOwnedByUser("),
        `${call.file} passes a caller-chosen value into ${call.entry} ` +
          `(scanners: ${call.scanners ?? "unset"}, portScan: ${call.portScan ?? "unset"}) ` +
          `without checking the requester owns the domain. Gate it the way ` +
          `app/api/v3/scan/route.ts does, or pass null.`,
      ).toBe(true);
      if (forwardsScanners) {
        expect(
          source.includes("requestsActiveProbing("),
          `${call.file} forwards a scanner list into ${call.entry} without ` +
            `asking requestsActiveProbing whether it names an active probe.`,
        ).toBe(true);
      }
    });
  }
});
