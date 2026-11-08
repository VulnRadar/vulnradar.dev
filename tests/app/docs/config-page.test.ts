import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BUILD_TIME_VARIABLES,
  COMPOSE_BUILD_ARGS,
} from "@/app/docs/config/build-time-variables";
import { SETTINGS_REGISTRY } from "@/lib/config/registry";
import * as CONFIG_VALUES from "@/lib/config/config-values";
import { SETTINGS_TABS } from "@/components/admin/features/settings-registry-utils";

/**
 * /docs/config is where an operator finds out which knob to turn. Each case
 * here is a claim that page makes about the code. They read the source rather
 * than rendering it, like the other docs suites: this tier has no DOM, and
 * these are questions about what the page says.
 */

const PAGE = readFileSync("app/docs/config/page.tsx", "utf8");

/** The page as a reader sees the words: no JSX spacers, no line wrapping. */
const flat = (source: string) =>
  source
    .replace(/\{" "\}/g, " ")
    .replace(/<\/?InlineCode>/g, "")
    .replace(/\s+/g, " ");

function between(start: string, end: string): string {
  const from = PAGE.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  const to = PAGE.indexOf(end, from);
  expect(to, end).toBeGreaterThan(from);
  return PAGE.slice(from, to);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("the three-row decision table", () => {
  const overview = flat(between('id="overview"', 'id="quick-reference"'));

  it("replaces the TL;DR", () => {
    expect(overview).not.toContain("TL;DR");
    expect(overview).toContain("Edit lib/config/config-values.ts");
    expect(overview).toContain("NEXT_PUBLIC_* build arg");
    expect(overview).toContain("The database value wins");
  });

  it("uses a real runtime key as its bare-key example", () => {
    expect(overview).toContain("RATE_LIMIT_LOGIN_ATTEMPTS=10");
    expect(SETTINGS_REGISTRY.RATE_LIMIT_LOGIN_ATTEMPTS.tier).toBe("runtime");
  });
});

describe("the bare-key env var", () => {
  it("is explained where the resolution order is", () => {
    const section = flat(
      between('title="Resolution order and propagation"', 'title="Reset'),
    );
    expect(section).toContain("the bare registry key");
    expect(section).toContain("RATE_LIMIT_LOGIN_ATTEMPTS=10");
  });

  it("is noted on runtime rows only: a build key has no such variable", () => {
    expect(flat(PAGE)).toContain(
      'def.tier === "runtime" ? `${def.help} Env var: ${key}.` : def.help',
    );
  });
});

describe("the build-time variables table", () => {
  const names = BUILD_TIME_VARIABLES.map((v) => v.name);

  it("sits above Layer 2 and renders the list", () => {
    const table = PAGE.indexOf('id="build-time-variables"');
    expect(table).toBeGreaterThan(-1);
    expect(table).toBeLessThan(PAGE.indexOf('id="layer-2"'));
    expect(PAGE).toContain("BUILD_TIME_VARIABLES.map");
  });

  const read = new Set(
    ["app", "lib", "components", "hooks"]
      .flatMap(sourceFiles)
      .concat("middleware.ts")
      .filter((path) => !path.replace(/\\/g, "/").startsWith("app/docs/"))
      .flatMap((path) =>
        [
          ...readFileSync(path, "utf8").matchAll(
            /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g,
          ),
        ].map((m) => m[1]),
      ),
  );

  it("lists every NEXT_PUBLIC_* the code reads, once", () => {
    expect(read.size).toBeGreaterThan(0);
    expect([...names].sort()).toEqual([...read].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it("agrees with the build args docker-compose.yml passes", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    const args = compose.match(/^ {6}args:\n((?: {8}.*\n)+)/m)?.[1] ?? "";
    const declared = [...args.matchAll(/^ {8}(NEXT_PUBLIC_[A-Z0-9_]+):/gm)].map(
      (m) => m[1],
    );
    expect(declared.length).toBeGreaterThan(0);
    expect([...COMPOSE_BUILD_ARGS].sort()).toEqual(declared.sort());
  });

  it("agrees with the build args the Dockerfile accepts", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const declared = [
      ...dockerfile.matchAll(/^ARG (NEXT_PUBLIC_[A-Z0-9_]+)/gm),
    ].map((m) => m[1]);
    expect([...COMPOSE_BUILD_ARGS].sort()).toEqual(declared.sort());
  });

  it("tells a build arg to rebuild and anything else that Docker cannot", () => {
    for (const { name, apply } of BUILD_TIME_VARIABLES) {
      expect(apply, name).toContain("npm run build");
      if (COMPOSE_BUILD_ARGS.includes(name)) {
        expect(apply, name).toContain("docker compose build app");
      } else {
        expect(apply, name).toContain("Not a Docker build arg");
      }
    }
  });

  it("only points at CONFIG_ constants that exist", () => {
    const pointed = BUILD_TIME_VARIABLES.flatMap((v) =>
      [...v.apply.matchAll(/CONFIG_[A-Z0-9_]+/g)].map((m) => m[0]),
    );
    expect(pointed.length).toBeGreaterThan(0);
    for (const name of pointed)
      expect(CONFIG_VALUES, name).toHaveProperty(name);
  });

  it("marks the three things a pulled image cannot do in Quick Reference", () => {
    const rows = flat(between('id="quick-reference"', 'id="architecture"'));
    for (const what of ["Your own domain", "Turnstile", "Stripe checkout"]) {
      expect(rows, what).toMatch(
        new RegExp(`what: "${what}",[^}]*build: "Yes"`),
      );
    }
  });
});

describe("Layer 2 anchors", () => {
  const layer2 = between('id="layer-2"', 'id="ai-models"');
  const subsections = [...layer2.matchAll(/<DocsSubSection\b[^>]*>/g)].map(
    (m) => m[0],
  );

  it("gives every subsection an id", () => {
    expect(subsections.length).toBeGreaterThan(0);
    for (const tag of subsections) expect(tag).toMatch(/\bid="[a-z0-9-]+"/);
  });

  it.each([
    "smtp",
    "stripe",
    "oauth",
    "turnstile",
    "ai-provider",
    "backups",
    "docker-only",
    "proxy",
  ])("has #%s", (id) => {
    expect(layer2).toContain(`id="${id}"`);
  });

  it("keeps ids unique across the page", () => {
    const ids = [...PAGE.matchAll(/\bid="([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has moved TRUSTED_PROXY_CIDR out of Database", () => {
    expect(between('title="Database"', 'title="Reverse proxy"')).not.toContain(
      "TRUSTED_PROXY_CIDR",
    );
    expect(between('title="Reverse proxy"', 'title="Email (SMTP)"')).toContain(
      "TRUSTED_PROXY_CIDR",
    );
  });
});

describe("sections the docs nav points at", () => {
  // Removing one of these breaks a link someone already followed or saved.
  it.each([
    "overview",
    "quick-reference",
    "architecture",
    "layer-1",
    "app-metadata",
    "emails",
    "branding",
    "cookies",
    "auth-timeouts",
    "rate-limits",
    "scanning",
    "api",
    "demo-mode",
    "db-constraints",
    "pagination",
    "feature-flags",
    "billing",
    "admin-settings",
    "layer-2",
    "oauth-redirect-uris",
    "operations-env",
    "ai-models",
    "checklist",
    "validation",
  ])("still has #%s", (id) => {
    expect(PAGE).toContain(`id="${id}"`);
  });
});

describe("the rate-limit section", () => {
  const section = between('id="rate-limits"', 'id="scanning"');

  it("links to the generated group instead of restating it", () => {
    expect(section).not.toContain("<DocsTable");
    expect(section).toContain('href={`#${settingsGroupId("Rate Limits")}`}');
  });

  it("is right that every window is in minutes", () => {
    expect(flat(section)).toContain("every window is in minutes");
    const windows = Object.keys(SETTINGS_REGISTRY).filter((key) =>
      /^RATE_LIMIT_.*WINDOW/.test(key),
    );
    expect(windows.length).toBeGreaterThan(0);
    for (const key of windows) expect(key).toMatch(/_WINDOW_MINUTES$/);
  });

  it("links to an anchor the generated tables really produce", () => {
    expect(SETTINGS_TABS).toContain("Rate Limits");
    expect(PAGE).toContain("id={settingsGroupId(group)}");
    // The literal the generated id comes out as, which the toc row uses.
    expect(PAGE).toContain("`settings-${group.toLowerCase().replace(");
  });
});

describe("Turnstile", () => {
  const verifying = sourceFiles("app/api").filter((path) =>
    readFileSync(path, "utf8").includes(
      "challenges.cloudflare.com/turnstile/v0/siteverify",
    ),
  );

  it("counts the endpoints that really verify a token", () => {
    expect(verifying).toHaveLength(3);

    const section = flat(
      between('title="Cloudflare Turnstile"', 'title="Threat reputation'),
    );
    expect(section).toContain("the three write endpoints");
    expect(section).not.toContain("landing-page contact form");
  });
});

describe("the offsite backup row", () => {
  it("says one object per backup, with the IV and tag inside the file", () => {
    const row = flat(between("BACKUP_OFFSITE_UPLOAD_URL", "</li>"));
    expect(row).toContain("exactly one object per backup");
    expect(row).toContain("IV and auth tag travel inside the encrypted file");
  });
});

describe("the checklist's first-admin step", () => {
  // Goes away with the checklist section itself.
  const section = flat(between('id="checklist"', 'id="validation"'));

  it("says there is nothing to promote", () => {
    expect(section).toContain(
      "Sign up the first user at /signup. That account is created as super_admin; there is nothing to promote. Only promote a later account",
    );
    expect(section).toContain("Self-Hosting &gt; First Admin User");
    expect(section).toContain('href="/docs/self-hosting#admin"');
  });
});

describe("SQL samples", () => {
  it("never write out an email address", () => {
    expect(PAGE).not.toMatch(/WHERE\s+email\s*=\s*(?:'|&apos;)[^'&]*@/i);
  });
});
