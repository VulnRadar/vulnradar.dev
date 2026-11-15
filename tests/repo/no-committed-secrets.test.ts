import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * VulnRadar's own secret shapes, over every tracked file.
 *
 * The Secret scan job runs gitleaks over the commits a change adds, and its
 * path allowlists skip the scanner's detector code, its fixtures and the
 * docs placeholders, which quote other providers' fake secrets on purpose.
 * None of those has any reason to hold a real VulnRadar API key or a real
 * server secret, so this checks the two VulnRadar rules everywhere, those
 * paths included, and on the tree as it is rather than on a diff.
 *
 * The patterns are the ones .gitleaks.toml declares, read from that file, so
 * the test and the scanner cannot come to disagree. A finding is reported as
 * file, line and rule, never with the value.
 */

const ROOT = path.resolve(__dirname, "../..");
const toml = readFileSync(path.join(ROOT, ".gitleaks.toml"), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** The literal regex of a custom rule in .gitleaks.toml, by id. */
function ruleRegex(id: string): string {
  const block = toml
    .split(/^\[\[rules\]\]$/m)
    .find((b) => new RegExp(`^id = "${id}"$`, "m").test(b));
  if (!block) throw new Error(`.gitleaks.toml has no rule ${id}`);
  const m = /^regex = '''(.+)'''$/m.exec(block);
  if (!m) throw new Error(`rule ${id} has no literal regex`);
  return m[1];
}

// The same patterns, written in gitleaks' (RE2) syntax.
const API_KEY = "vr_live_[a-f0-9]{64}";
const HEX_SECRET = `(API_KEY_ENCRYPTION_KEY|PREVIOUS_API_KEY_ENCRYPTION_KEY|BACKUP_ENCRYPTION_KEY|AUTH_SECRET)["']?[[:space:]]*[:=][[:space:]]*["']?[A-Fa-f0-9]{64}`;

/** RE2's POSIX class has no JavaScript spelling; everything else is shared. */
const toJs = (re2: string) =>
  new RegExp(re2.split("[[:space:]]").join("[ \\t\\r\\n\\f\\v]"), "g");

/**
 * The values CI sets on purpose, the same three .gitleaks.toml allowlists:
 * a key of zeros, the fixed smoke-test key, and the Build job's sentinel
 * that the client-bundle check searches for.
 */
const CI_VALUES = new Set([
  "0".repeat(64),
  "00112233445566778899aabbccddeeff".repeat(2),
  "5e".repeat(32),
]);

interface Hit {
  file: string;
  line: number;
  rule: string;
}

/** Every hit in one file's text. The value is used to decide, never kept. */
function scan(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(toJs(API_KEY))) {
      if (m[0]) hits.push({ file, line: i + 1, rule: "vulnradar-api-key" });
    }
    for (const m of line.matchAll(toJs(HEX_SECRET))) {
      const value = m[0].slice(-64);
      if (CI_VALUES.has(value)) continue;
      hits.push({ file, line: i + 1, rule: "vulnradar-hex-secret" });
    }
  });
  return hits;
}

const describeHit = (h: Hit) => `${h.file}:${h.line} ${h.rule}`;

describe("the patterns", () => {
  it("are the two custom rules in .gitleaks.toml", () => {
    expect(ruleRegex("vulnradar-api-key")).toBe(API_KEY);
    expect(ruleRegex("vulnradar-hex-secret")).toBe(HEX_SECRET);
  });

  it("allowlist in .gitleaks.toml exactly the CI values this test allows", () => {
    const listed = [...toml.matchAll(/^ {2}'''\^?(.+?)\$?'''[,]$/gm)].map(
      (m) => m[1],
    );
    expect(listed).toEqual(
      expect.arrayContaining([
        "0{64}",
        "(00112233445566778899aabbccddeeff){2}",
        "(5e){32}",
      ]),
    );
  });
});

/** The path regexes of every [[allowlists]] block, in gitleaks' syntax. */
function allowlistedPaths(): RegExp[] {
  return toml
    .split(/^\[\[allowlists\]\]$/m)
    .slice(1)
    .flatMap((block) => {
      const body = /^paths = \[\n([\s\S]*?)^\]$/m.exec(block)?.[1] ?? "";
      return [...body.matchAll(/^ {2}'''(.+)''',$/gm)].map(
        (m) => new RegExp(m[1]),
      );
    });
}

describe("the path allowlists", () => {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  const paths = allowlistedPaths();
  const skipped = (file: string) => paths.some((re) => re.test(file));

  it("are read from the file", () => {
    expect(paths.length).toBeGreaterThanOrEqual(5);
  });

  it("each name at least one tracked file", () => {
    for (const re of paths) {
      expect(
        tracked.some((f) => re.test(f)),
        String(re),
      ).toBe(true);
    }
  });

  // gitleaks' default rules see nothing an allowlist names, so a directory
  // entry hides everything that later lands in it. The scanner's runtime
  // code handles real credentials (the sign-in flows) and quotes no fake
  // ones, so it stays scanned, and so does the rest of the test tree.
  it("leave the scanner's runtime code and the rest of tests/lib scanned", () => {
    for (const file of [
      "lib/scanner/engine.ts",
      "lib/scanner/execute-scan.ts",
      "lib/scanner/auth/login.ts",
      "lib/scanner/auth/browser-login.ts",
    ]) {
      expect(tracked, file).toContain(file);
      expect(skipped(file), file).toBe(false);
    }
    for (const dir of [
      "lib/scanner/auth/",
      "lib/scanner/active-probes/",
      "tests/lib/auth/",
      "tests/lib/billing/",
    ]) {
      const under = tracked.filter((f) => f.startsWith(dir));
      expect(under.length, dir).toBeGreaterThan(0);
      expect(under.filter(skipped), dir).toEqual([]);
    }
  });
});

describe("the matcher", () => {
  // Built here and never written anywhere, so no file in the tree holds one.
  const key = `vr_live_${randomBytes(32).toString("hex")}`;
  const hex = randomBytes(32).toString("hex");

  it("finds a key, and reports where without the value", () => {
    const hits = scan("x.ts", `const k = "${key}";`);
    expect(hits).toEqual([
      { file: "x.ts", line: 1, rule: "vulnradar-api-key" },
    ]);
    expect(hits.map(describeHit).join("\n")).not.toContain(key);
    expect(hits.map(describeHit).join("\n")).not.toContain(key.slice(8, 24));
  });

  it.each([
    [`API_KEY_ENCRYPTION_KEY=${hex}`],
    [`  API_KEY_ENCRYPTION_KEY: ${hex}`],
    [`  BACKUP_ENCRYPTION_KEY: "${hex}"`],
    [`{"AUTH_SECRET": "${hex}"}`],
    [`process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = '${hex}';`],
  ])("finds a server secret assigned as %s", (line) => {
    const hits = scan("x", line);
    expect(hits.map((h) => h.rule)).toEqual(["vulnradar-hex-secret"]);
    expect(hits.map(describeHit).join("\n")).not.toContain(hex);
  });

  it("lets the documented CI values through", () => {
    for (const value of CI_VALUES) {
      expect(scan("ci.yml", `API_KEY_ENCRYPTION_KEY=${value}`)).toEqual([]);
    }
  });

  it("does not match a shorter value or another variable", () => {
    expect(scan("x", `API_KEY_ENCRYPTION_KEY=${hex.slice(0, 63)}`)).toEqual([]);
    expect(scan("x", `SOME_OTHER_KEY=${hex}`)).toEqual([]);
    expect(scan("x", `vr_live_${hex.slice(0, 63)}`)).toEqual([]);
  });
});

describe("the tracked files", () => {
  it("hold no VulnRadar API key and no server secret", () => {
    const files = execFileSync("git", ["ls-files", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(100);
    const hits: Hit[] = [];
    for (const file of files) {
      let buf: Buffer;
      try {
        buf = readFileSync(path.join(ROOT, file));
      } catch {
        // Deleted in the working tree but still in the index.
        continue;
      }
      // Binary files: a NUL in the first 8 KB, as git decides.
      if (buf.subarray(0, 8192).includes(0)) continue;
      hits.push(...scan(file, buf.toString("utf8")));
    }
    expect(hits.map(describeHit)).toEqual([]);
  });
});
