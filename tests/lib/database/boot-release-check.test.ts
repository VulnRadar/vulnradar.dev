import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportRunningVersion } from "@/lib/database/boot/release-check";

/**
 * The startup banner's "is there a newer release" line. It used to loop over
 * the first three dot-separated numbers itself, which read 4.0.0-rc.1 as
 * 4.0.0; it now asks lib/updater/version-compare.ts, the same comparison the
 * admin updater and GET /api/version use.
 */

const CONTEXT = {
  appName: "VulnRadar",
  engineVersion: "3.3.0",
  versionCheckUrl: "https://api.example.test/releases/latest",
  releasesUrl: "https://example.test/releases",
};

let lines: string[];

// The colour escapes the banner wraps its prefix in. Built from the character
// code so no control character sits in a regex literal.
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, "g");

function release(tagName: string, htmlUrl?: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: tagName, html_url: htmlUrl }),
    })),
  );
}

async function run(appVersion: string): Promise<string> {
  lines = [];
  await reportRunningVersion({ ...CONTEXT, appVersion });
  // Drop the colour escapes so the assertions read as the operator sees them.
  return lines.join("\n").replace(ANSI_COLOUR, "");
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("reportRunningVersion", () => {
  it("prints the running version first", async () => {
    release("v3.9.1");
    const out = await run("3.9.1");
    expect(out.split("\n")[0]).toBe(
      "[VulnRadar] Starting VulnRadar v3.9.1 (Detection Engine v3.3.0)",
    );
  });

  it("says so when the install is on the latest release", async () => {
    release("v3.9.1");
    expect(await run("3.9.1")).toContain(
      "You're running the latest version (v3.9.1).",
    );
  });

  it("points at the release page when a newer one exists", async () => {
    release("v4.0.0", "https://example.test/releases/tag/v4.0.0");
    const out = await run("3.9.1");
    expect(out).toContain(
      "Update available! You're on v3.9.1, latest is v4.0.0.",
    );
    expect(out).toContain("https://example.test/releases/tag/v4.0.0");
  });

  it("builds the release link itself when the response carries none", async () => {
    release("v4.0.0");
    expect(await run("3.9.1")).toContain(
      "https://example.test/releases/tag/v4.0.0",
    );
  });

  it("tells a release candidate that the release it leads up to is an update", async () => {
    release("v4.0.0");
    const out = await run("4.0.0-rc.1");
    expect(out).toContain("Update available!");
    expect(out).not.toContain("latest version");
  });

  it("notes an install that is ahead of the latest release", async () => {
    release("v3.9.1");
    const out = await run("4.0.0");
    expect(out).toContain("Running v4.0.0, but latest release is v3.9.1.");
    // The second line is one of the shared time-traveller messages.
    expect(out.split("\n")).toHaveLength(3);
    expect(out.split("\n")[2]).toMatch(/^\[VulnRadar\] \S/);
  });

  it("stays quiet about versions when GitHub answers with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    const out = await run("3.9.1");
    expect(out.split("\n")).toHaveLength(1);
  });

  it("boots on, with a one-line note, when the lookup fails outright", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND api.example.test");
      }),
    );
    expect(await run("3.9.1")).toContain(
      "Could not check for updates. Running v3.9.1.",
    );
  });
});
