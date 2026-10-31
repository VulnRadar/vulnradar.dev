/**
 * The scanner's User-Agent strings. Every request that reaches a scan target
 * names the same product token, which is what lets a site owner allowlist or
 * recognise scan traffic with one rule, so these tests pin the token, the
 * shapes built around it, and the rule that no scanner module sets a
 * User-Agent without it. The call sites themselves are asserted in the suites
 * of the modules that make the requests.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import {
  SCANNER_UA,
  SCANNER_UA_ACTIVE_PROBE,
  SCANNER_UA_AUTHENTICATED,
  SCANNER_UA_DISCOVERY,
  SCANNER_UA_PRODUCT,
} from "@/lib/scanner/user-agent";

describe("SCANNER_UA_PRODUCT", () => {
  it("is the app name and version 1.0, the token a site owner matches on", () => {
    expect(SCANNER_UA_PRODUCT).toBe(`${APP_NAME}/1.0`);
    expect(SCANNER_UA_PRODUCT).toBe("VulnRadar/1.0");
  });
});

describe("the variants built around it", () => {
  it("all contain the product token", () => {
    for (const ua of [
      SCANNER_UA,
      SCANNER_UA_AUTHENTICATED,
      SCANNER_UA_ACTIVE_PROBE,
      SCANNER_UA_DISCOVERY,
    ]) {
      expect(ua).toContain(SCANNER_UA_PRODUCT);
    }
  });

  it("keeps the Mozilla (compatible; ...) shape crawler allowlists expect, with the contact URL", () => {
    expect(SCANNER_UA).toBe(
      `Mozilla/5.0 (compatible; VulnRadar/1.0; +${APP_URL})`,
    );
  });

  it("says what an authenticated request is for", () => {
    expect(SCANNER_UA_AUTHENTICATED).toBe(
      "VulnRadar/1.0 (Security Scanner; Authenticated)",
    );
  });

  it("says what an active-probe request is for, with the contact URL", () => {
    expect(SCANNER_UA_ACTIVE_PROBE).toBe(
      `VulnRadar/1.0 (Security Scanner; Active Probe; +${APP_URL})`,
    );
  });

  it("keeps discovery's third-party sources on the bare compatible form", () => {
    expect(SCANNER_UA_DISCOVERY).toBe(
      "Mozilla/5.0 (compatible; VulnRadar/1.0)",
    );
  });

  it("are all different strings, because each says something different", () => {
    const all = [
      SCANNER_UA,
      SCANNER_UA_AUTHENTICATED,
      SCANNER_UA_ACTIVE_PROBE,
      SCANNER_UA_DISCOVERY,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

// A repo-level guard: the call-site suites prove the requests that exist, this
// stops a new one from naming some other client. It reads the source because
// the thing it guards is what a future author types.
describe("no scanner module sets a User-Agent without the product token", () => {
  const root = path.resolve(__dirname, "../../../lib/scanner");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return full.endsWith(".ts") ? [full] : [];
    });
  }

  // A header value is fine when it is one of the shared constants, an alias
  // of one (the active probes' USER_AGENT), the crawler's own token, or a
  // template that spells out `${APP_NAME}/1.0` itself.
  const ACCEPTED = [
    /^SCANNER_UA\w*$/,
    /^USER_AGENT$/,
    /^CRAWLER_UA$/,
    /\$\{APP_NAME\}\/1\.0/,
    /\$\{SCANNER_UA_PRODUCT\}/,
  ];

  it("finds the header in the files that build requests (the guard is looking at something)", () => {
    const withHeader = sourceFiles(root).filter((f) =>
      /["']User-Agent["']\s*:/.test(readFileSync(f, "utf8")),
    );
    expect(withHeader.length).toBeGreaterThanOrEqual(10);
  });

  it("holds for every User-Agent header under lib/scanner", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(/["']User-Agent["']\s*:\s*([^,\n]+)/g)) {
        // The value runs to the next comma or the end of the line. When the
        // header sits last in an inline object that takes the closing brace
        // with it, which is not part of the value.
        const value = match[1].trim().replace(/\s*\}+$/, "");
        if (!ACCEPTED.some((pattern) => pattern.test(value))) {
          offenders.push(`${path.relative(root, file)}: ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
