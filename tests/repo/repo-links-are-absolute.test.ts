/**
 * APP_REPO is "owner/repo", not a URL.
 *
 * Used in an href without "https://github.com/" in front of it, the browser
 * resolves it against whatever host the app is being served from, so the
 * Language setting's link to the translation files pointed at
 * sandbox.vulnradar.dev/VulnRadar/vulnradar.dev/tree/main/... on the sandbox,
 * and would point at a customer's own host on a self-hosted install.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "app", "components", "lib"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f));
}

describe("links built from APP_REPO", () => {
  it("always name github.com, so they cannot resolve against this host", () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("APP_REPO")) continue;
      source.split("\n").forEach((line, index) => {
        // A template literal that STARTS with APP_REPO is a path, not a URL.
        if (!/`\$\{APP_REPO\}/.test(line)) return;
        if (line.includes("github.com")) return;
        offenders.push(`${file}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
