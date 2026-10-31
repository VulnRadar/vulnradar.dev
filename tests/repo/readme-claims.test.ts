import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REQUIRED_EVENTS } from "@/lib/billing/stripe-webhook-events";
import { LOCALES } from "@/lib/i18n/config";
import { VERSIONS } from "../../scripts/migrate/_registry.mjs";

/**
 * What the README, CONTRIBUTING, scripts/README and the two contributor docs
 * pages say about the repo, held against the repo.
 *
 * Every assertion here exists because the sentence it guards was wrong at some
 * point and nothing noticed: the README said the only outbound call was the
 * admin's update check (the app also asks GitHub at every boot, and each scan
 * queries public data sources), said API keys were hashed with bcrypt (they are
 * AES-256-GCM ciphertext), told a reader to edit config-values.ts and then run
 * a command that deploys the unedited published image, and said the app only
 * refuses to store TOTP secrets without its key (it refuses to start). The
 * architecture page drew directories that were never there, and the scripts
 * README counted files and tables from two releases ago.
 *
 * These read the prose as text. The point is that a claim names something the
 * code can answer, and the code is asked.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** JSX comments and line comments removed, so a "this used to say X" note
 * does not trip an assertion looking for X in the rendered copy. */
function prose(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const pkg = JSON.parse(read("package.json")) as {
  version: string;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

/**
 * The paths an ASCII tree names, one per `├── name` / `└── name` line.
 *
 * Depth comes from the width of the guide prefix (four columns per level), and
 * a directory line (trailing slash) becomes the parent of the deeper lines
 * that follow it. Entries that are not a single path are skipped: a glob
 * (`_lib.check-*.mjs`), a parenthetical, and the first word of a
 * comma-separated list.
 */
function treePaths(block: string, rootDir = ""): string[] {
  const parents: (string | undefined)[] = [];
  const found: string[] = [];
  for (const line of block.split("\n")) {
    const match = line.match(/^([│ ]*)(?:├──|└──)\s+(\S+)/);
    if (!match) continue;
    const depth = match[1].length / 4;
    const name = match[2];
    parents.length = depth;
    if (/[*,(]/.test(name)) continue;
    const chain = Array.from(parents);
    // A line under an entry that was skipped has no known parent.
    if (chain.some((parent) => parent === undefined)) continue;
    const clean = name.replace(/\/$/, "");
    found.push(path.posix.join(rootDir, ...(chain as string[]), clean));
    if (name.endsWith("/")) parents[depth] = clean;
  }
  return found;
}

/** Tracked files under `dir`, as paths relative to it. */
function trackedUnder(dir: string): string[] {
  return execFileSync("git", ["ls-files", dir], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .map((file) => file.slice(dir.length + 1));
}

function missing(paths: string[]): string[] {
  return paths.filter((p) => !existsSync(path.join(ROOT, p)));
}

/** Every route file under app/api whose path contains `fragment`. */
function routeFiles(fragment: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), {
      withFileTypes: true,
    })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name === "route.ts" && rel.includes(fragment))
        out.push(rel);
    }
  };
  walk("app/api");
  return out;
}

const eslintMajor = Number.parseInt(
  pkg.devDependencies.eslint.replace(/^[^\d]*/, ""),
  10,
);

describe("README.md", () => {
  const readme = read("README.md");

  it("points the outbound-traffic claim at the egress list, not at one call", () => {
    expect(readme).toContain("/docs/self-hosting#network-egress");
    expect(readme).not.toMatch(/only\s+outbound\s+call/i);
  });

  it("tells the reader to build when it tells them to edit config-values.ts", () => {
    // `docker compose up` with no --build runs the published image, which
    // carries upstream's name and URL, so the edit would silently not be there.
    const snippet = readme.match(
      /```bash\n[\s\S]*?config-values\.ts[\s\S]*?```/,
    );
    expect(snippet, "the self-host snippet").not.toBeNull();
    expect(snippet?.[0]).toMatch(/docker compose up -d --build/);
  });

  it("says API keys are encrypted, which is what the code does", () => {
    expect(readme).toMatch(/API keys are encrypted at rest with AES-256-GCM/);
    expect(readme).toMatch(/HMAC locator/);
    expect(readme).not.toMatch(/bcrypt for API key/i);
    expect(readme).not.toMatch(/API keys?[^.]{0,40}\bhash(?:ed|ing)\b/i);

    expect(read("lib/auth/crypto.ts")).toContain('"aes-256-gcm"');
    expect(read("lib/api/api-keys.ts")).toMatch(/createHmac\("sha256"/);
  });

  it("says the app refuses to start without API_KEY_ENCRYPTION_KEY, and it does", () => {
    expect(readme).toMatch(/refuses to start without/);
    expect(readme).not.toMatch(/refuses to store TOTP/);

    // The schema marks the key required, and boot validates it before it
    // opens the pool or touches the schema.
    expect(read("lib/config/env.ts")).toMatch(
      /RequiredSchema = z\.object\(\{[\s\S]*?API_KEY_ENCRYPTION_KEY/,
    );
    const boot = read("instrumentation.ts");
    expect(boot.indexOf("validateEnv()")).toBeGreaterThan(-1);
    expect(boot.indexOf("validateEnv()")).toBeLessThan(
      boot.indexOf("applyBootSchema"),
    );
  });

  it("describes the lint script package.json defines", () => {
    expect(pkg.scripts.lint).toMatch(/^oxlint\b.*\beslint\b/);
    expect(readme).toMatch(/`npm run lint`\s*\|\s*Oxlint, then ESLint/);
  });
});

describe("the architecture page", () => {
  const rel = "app/docs/architecture/page.tsx";
  const page = prose(rel);

  it("renders the Stripe events from REQUIRED_EVENTS instead of listing them", () => {
    expect(page).toContain("REQUIRED_EVENTS.map");
    for (const event of REQUIRED_EVENTS) {
      expect(page, `${event} typed out by hand`).not.toContain(event);
    }
    // The old bullet named six events as "customer.subscription.created/updated/deleted".
    expect(page).not.toMatch(/subscription\.created\/updated/);
  });

  it("describes input handling as parseBody plus Validate, with Zod as the exception", () => {
    expect(page).not.toMatch(/Zod\s+via\s+Validate/);
    expect(page).not.toMatch(/Validates input with Zod/);
    expect(page).toContain("parseBody");
    expect(page).toContain("(parseBody + Validate)");

    expect(read("lib/api/api-utils.ts")).toMatch(
      /export async function parseBody/,
    );
    expect(read("lib/api/api-utils.ts")).toMatch(/export const Validate\b/);
  });

  it("names Zod only where Zod is imported", () => {
    for (const file of [
      "lib/config/env.ts",
      "lib/config/registry.ts",
      "lib/ai/chat/tools.ts",
    ]) {
      expect(read(file), file).toMatch(/from "zod"/);
    }
    // The page names three request bodies. Asked by route fragment, not by a
    // full path, so moving the route tree does not make this a different test.
    for (const fragment of [
      "/scan/authenticated/",
      "/scan/feedback/",
      "/scan/remediation/",
    ]) {
      const files = routeFiles(fragment);
      expect(files.length, `a route under ${fragment}`).toBeGreaterThan(0);
      expect(
        files.some((f) => /from "zod"/.test(read(f))),
        `${fragment} validates its body with Zod`,
      ).toBe(true);
    }
  });

  it("ends the request lifecycle in ApiResponse.success and error, which exist", () => {
    expect(page).not.toContain("ApiResponse.json");
    expect(page).toContain("ApiResponse.success");
    expect(page).toContain("ApiResponse.error");

    const api = read("lib/api/api-utils.ts");
    expect(api).toMatch(/\bsuccess:\s*</);
    expect(api).toMatch(/\berror:\s*\(/);
  });

  it("draws only directories and files that exist", () => {
    const start = page.indexOf("vulnradar.dev/\n");
    const end = page.indexOf("`}", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const named = treePaths(page.slice(start, end));
    // Guard the parser itself: a tree this long that yields nothing means the
    // regex stopped matching, which would turn this test into a no-op.
    expect(named.length).toBeGreaterThan(40);
    expect(named).toContain("app/api/v3");
    expect(missing(named)).toEqual([]);
  });

  it("says the schema is applied by apply-boot-schema, and instrumentation calls it", () => {
    expect(page).toContain("apply-boot-schema");
    expect(
      existsSync(path.join(ROOT, "lib/database/boot/apply-boot-schema.ts")),
    ).toBe(true);
    expect(read("instrumentation.ts")).toContain("applyBootSchema");
  });

  it("does not tell the schema's edit history on a reference page", () => {
    expect(page).not.toMatch(/It used to be\s+4,000/);
  });

  it("states the client config rule as far as the code enforces it", () => {
    // Client files also import brand, feature-surfaces, registry and
    // config-values, so "the only config module" is false. What
    // client-server-split.test.ts fails on is a client file importing
    // constants.ts, the server-side superset.
    expect(page).not.toMatch(/only\s+config\s+module/);
    expect(read("tests/lib/config/client-server-split.test.ts")).toContain(
      "does not let a new client component import the server config module",
    );
  });

  it("lists each config module once", () => {
    for (const file of ["registry.ts", "runtime-config.ts"]) {
      const tag = `<InlineCode>lib/config/${file}</InlineCode>`;
      expect(page.split(tag).length - 1, file).toBe(1);
    }
  });

  it("names the ESLint major package.json installs, after Oxlint", () => {
    const named = [...page.matchAll(/ESLint (\d+)/g)].map((m) => Number(m[1]));
    expect(named.length).toBeGreaterThan(0);
    for (const major of named) expect(major).toBe(eslintMajor);
    expect(page).toMatch(/Oxlint, then ESLint/);
  });
});

describe("the developers page", () => {
  const rel = "app/docs/developers/page.tsx";
  const page = prose(rel);

  it("quotes the Node patch the Dockerfile builds on", () => {
    const pins = new Set(
      [
        ...read("Dockerfile").matchAll(/^FROM node:(\d+\.\d+\.\d+)-alpine/gm),
      ].map((m) => m[1]),
    );
    expect(pins.size, "every FROM node line agrees").toBe(1);
    const [pin] = [...pins];

    // 22.0.0 is the engines floor and 22.12.0 is vitest's own floor: ranges,
    // not pins. Anything else shaped like a 22.x.y is meant to be the pin.
    const quoted = new Set(
      [...page.matchAll(/\b22\.\d+\.\d+\b/g)]
        .map((m) => m[0])
        .filter((v) => v !== "22.0.0" && v !== "22.12.0"),
    );
    expect([...quoted]).toEqual([pin]);
  });

  it("names the ESLint major package.json installs, after Oxlint", () => {
    const named = [...page.matchAll(/ESLint (\d+)/g)].map((m) => Number(m[1]));
    expect(named.length).toBeGreaterThan(0);
    for (const major of named) expect(major).toBe(eslintMajor);
    expect(page).toMatch(/runs\s+Oxlint/);
    expect(page).toContain("lint:fix");
  });

  it("explains how to add a docs page, against files that exist", () => {
    expect(page).toContain("Adding a docs page");
    expect(page).toContain("components/docs/docs-nav.ts");
    expect(page).toContain("DOCS_NAV");
    expect(page).toContain("npm run build:knowledge");
    expect(read("components/docs/docs-nav.ts")).toMatch(
      /export const DOCS_NAV\b/,
    );
    expect(pkg.scripts["build:knowledge"]).toBeDefined();
  });

  it("links the translation guide and the contributor guide on GitHub", () => {
    expect(page).toContain("/blob/main/lib/i18n/README.md");
    expect(page).toContain("/blob/main/CONTRIBUTING.md");
    expect(existsSync(path.join(ROOT, "lib/i18n/README.md"))).toBe(true);
    expect(existsSync(path.join(ROOT, "CONTRIBUTING.md"))).toBe(true);
  });

  it("calls SECURITY_ALLOW_NON_BROWSER_API dev-only, as middleware enforces", () => {
    expect(page).toContain("SECURITY_ALLOW_NON_BROWSER_API=1");
    expect(page).toMatch(/does nothing\s+when[\s\S]{0,160}production/);
    expect(read("middleware.ts")).toMatch(
      /NODE_ENV !== "production"[\s\S]{0,60}SECURITY_ALLOW_NON_BROWSER_API/,
    );
  });

  it("mentions the updater switch the Dockerfile sets and the code reads", () => {
    expect(page).toContain("VULNRADAR_UPDATER_DISABLED=true");
    expect(read("Dockerfile")).toMatch(/^ENV VULNRADAR_UPDATER_DISABLED=true/m);
    expect(read("lib/updater/environment.ts")).toContain(
      "VULNRADAR_UPDATER_DISABLED",
    );
  });
});

describe("CONTRIBUTING.md", () => {
  const contributing = read("CONTRIBUTING.md");

  it("has a Translations section that links the guide instead of restating it", () => {
    const section = contributing.match(/## Translations\n([\s\S]*?)(?=\n## )/);
    expect(section, "a Translations section").not.toBeNull();
    expect(section?.[1]).toContain("lib/i18n/README.md");
    expect(section?.[1]).toContain("lib/i18n/messages");

    expect(existsSync(path.join(ROOT, "lib/i18n/README.md"))).toBe(true);
    // The section only says where the wording lives, and that has to hold when
    // a language is one file (messages/de.json) and when it is a folder of
    // per-namespace files (messages/de/), which is the shape the split of the
    // messages gives it.
    for (const locale of LOCALES) {
      const base = path.join(ROOT, "lib/i18n/messages", locale);
      expect(
        existsSync(`${base}.json`) || existsSync(base),
        `messages for ${locale}`,
      ).toBe(true);
    }
  });

  it("describes the lint script package.json defines", () => {
    expect(contributing).toMatch(
      /`npm run lint`\s*\|\s*Run Oxlint, then ESLint/,
    );
  });
});

describe("scripts/README.md", () => {
  const readme = read("scripts/README.md");

  // The tree sits in the first fenced block, which opens on a line of its own
  // followed by "scripts/". (The title is "# scripts/" too, so the fence is
  // part of what is searched for.)
  const fence = readme.indexOf("```\nscripts/\n");
  const tree = readme.slice(fence + 4, readme.indexOf("```", fence + 4));

  it("draws only files and directories that exist", () => {
    expect(fence).toBeGreaterThan(-1);
    const named = treePaths(tree, "scripts");
    expect(named.length).toBeGreaterThan(40);
    expect(named).toContain("scripts/migrate/versions/_snippets.mjs");
    expect(missing(named)).toEqual([]);
  });

  it("names every top-level entry of scripts/", () => {
    const top = new Set(
      trackedUnder("scripts")
        .map((file) => file.split("/")[0])
        .filter((name) => name !== "README.md"),
    );
    expect(top.size).toBeGreaterThan(5);
    for (const name of top) {
      expect(tree, `${name} is missing from the layout`).toMatch(
        new RegExp(`(?:├──|└──) ${name.replace(/\./g, "\\.")}/?(?:\\s|$)`),
      );
    }
  });

  it("counts the _lib helpers the way the repository does", () => {
    const claimed = readme.match(/Shared helpers \((\d+) files\)/);
    expect(claimed, "the _lib file count").not.toBeNull();
    expect(Number(claimed?.[1])).toBe(trackedUnder("scripts/_lib").length);
  });

  it("lists every database, audit, knowledge and eval script package.json has", () => {
    const family =
      /^(?:db:|audit:|eval:|build:knowledge$|knowledge:index$|.+:compile$)/;
    const scripts = Object.keys(pkg.scripts).filter((name) =>
      family.test(name),
    );
    expect(scripts.length).toBeGreaterThan(20);
    for (const name of scripts) {
      expect(readme, `npm run ${name}`).toContain(`\`npm run ${name}\``);
    }
  });

  it("states the table count the schema registry derives", () => {
    const row = readme.match(/\*\*3\.0\.0\*\*\s*\|\s*(\d+)\s*\|/);
    expect(row, "the 3.0.0 row").not.toBeNull();
    const v3 = VERSIONS.find((v) => v.name === "3.0.0");
    expect(Number(row?.[1])).toBe(v3?.fingerprint.tables.size);
  });
});

describe("scripts/migrate/_registry.mjs", () => {
  // The label is what migrate.mjs prints next to each version in its picker.
  it("labels each version with the table count its fingerprint holds", () => {
    expect(VERSIONS.length).toBeGreaterThan(0);
    for (const version of VERSIONS) {
      const claimed = version.label.match(/(\d+) tables/);
      expect(claimed, `${version.name}: ${version.label}`).not.toBeNull();
      expect(Number(claimed?.[1]), version.name).toBe(
        version.fingerprint.tables.size,
      );
    }
  });
});
