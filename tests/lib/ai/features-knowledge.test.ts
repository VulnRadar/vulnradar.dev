import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SLASH_COMMANDS, buildHelpText } from "@/lib/ai/commands";

/**
 * The assistant answered "no" to "can we do GitHub repo scanning?" because
 * nothing in lib/ai had ever heard of /repos. lib/ai/features-knowledge.md is
 * the fix, and this suite is what stops the same hole reopening: a page added
 * under app/ that never reaches the compiled inventory is a feature the
 * assistant will deny again.
 *
 * It reads the committed artifact rather than running the compiler, on purpose.
 * The committed file is what ships and what the retriever indexes, so "the
 * compiler would have produced this" is not the question worth asking; "does
 * the file on disk cover the app on disk" is. CI regenerates and diffs
 * (.github/workflows/ci.yml), which closes the other half.
 */

const FEATURES = join(process.cwd(), "lib", "ai", "features-knowledge.md");
const APP_DIR = join(process.cwd(), "app");

function features(): string {
  return readFileSync(FEATURES, "utf8");
}

/**
 * Top-level app routes a user can navigate to.
 *
 * Mirrors SKIP_PREFIXES in scripts/knowledge/compile-features-knowledge.mjs:
 * /api is not a page, /docs has its own knowledge file, and /dev is a
 * development-only workbench that 404s in production.
 */
const NOT_A_FEATURE_PAGE = new Set(["api", "docs", "dev"]);

function topLevelRoutes(): string[] {
  return readdirSync(APP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_") && !/^\(.*\)$/.test(name))
    .filter((name) => !NOT_A_FEATURE_PAGE.has(name))
    .filter(
      (name) =>
        existsSync(join(APP_DIR, name, "page.tsx")) ||
        // A section root like /legal or /tools whose own index page sits one
        // level down still counts: its children are the feature.
        readdirSync(join(APP_DIR, name), { withFileTypes: true }).some(
          (child) =>
            child.isDirectory() &&
            existsSync(join(APP_DIR, name, child.name, "page.tsx")),
        ),
    )
    .sort();
}

describe("the compiled feature inventory covers the app", () => {
  it("exists and was generated, not hand-written", () => {
    expect(existsSync(FEATURES)).toBe(true);
    expect(features()).toContain("Auto-compiled from the routes under");
  });

  it("lists every top-level user-facing route", () => {
    const text = features();
    const routes = topLevelRoutes();
    // Sanity: if the walk finds almost nothing, the assertions below pass
    // vacuously and this guard is worthless.
    expect(routes.length).toBeGreaterThan(20);
    for (const route of routes) {
      expect(text, `/${route} is missing from features-knowledge.md`).toMatch(
        new RegExp(`^Route: /${route}(?:[/\\s]|$)`, "m"),
      );
    }
  });

  /**
   * The features the owner named when he reported this, plus the rest of the
   * signed-in navigation. Spelled out rather than derived, because the whole
   * complaint was about these specific answers being wrong, and a derived list
   * would not have caught the original bug either (the route existed the whole
   * time; nothing described it).
   */
  it("names the features people ask about, at their real routes", () => {
    const text = features();
    for (const route of [
      "/repos",
      "/attack-surface",
      "/compare",
      "/shares",
      "/badge",
      "/teams",
      "/assets",
      "/history",
      "/dashboard",
      "/public-scans",
      "/checks",
      "/pricing",
    ]) {
      expect(text, `${route} is missing`).toContain(`Route: ${route}\n`);
    }
  });

  it("says whether each page needs a session", () => {
    const text = features();
    const routeLines = text.match(/^Route: /gm) ?? [];
    const accessLines = text.match(/^Access: /gm) ?? [];
    expect(routeLines.length).toBeGreaterThan(40);
    expect(accessLines.length).toBe(routeLines.length);
  });

  it("marks /repos as a signed-in page and describes what it reviews", () => {
    const block = features().match(
      /^### [^\n]*\nRoute: \/repos\n[\s\S]*?\n\n/m,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toContain("signed in");
    expect(block![0].toLowerCase()).toContain("github");
  });

  /**
   * The compiler emits a "no description could be quoted" placeholder for a
   * page whose purpose it cannot read out of the source, which is deliberate:
   * an invented description is worse than none. It is only acceptable while it
   * stays a minority, though. If most of the file turns into placeholders the
   * extractors have stopped matching the page shapes and the inventory has
   * quietly become a list of URLs.
   */
  it("quotes real prose for most routes, not placeholders", () => {
    const text = features();
    const routes = (text.match(/^Route: /gm) ?? []).length;
    const placeholders = (text.match(/^This page exists at /gm) ?? []).length;
    expect(placeholders).toBeLessThan(routes / 2);
  });

  it("never invents a description with an unresolved template expression", () => {
    // A leftover ${...} or {ident} is the shape of a half-substituted value,
    // which is exactly what the compiler is supposed to reject rather than
    // publish.
    expect(features()).not.toMatch(/\$\{/);
  });
});

describe("the /features command is wired everywhere the others are", () => {
  it("is a registered slash command", () => {
    expect(SLASH_COMMANDS.map((c) => c.cmd)).toContain("features");
  });

  it("appears in the help text the widget renders", () => {
    expect(buildHelpText()).toContain("/features");
  });

  it("is handled by the context route", () => {
    const route = readFileSync(
      join(process.cwd(), "app", "api", "v3", "ai", "context", "route.ts"),
      "utf8",
    );
    expect(route).toContain('case "features"');
    expect(route).toContain("features-knowledge.md");
  });

  it("is named in the system prompt's command list", () => {
    const prompt = readFileSync(
      join(process.cwd(), "lib", "ai", "system-prompt.ts"),
      "utf8",
    );
    expect(prompt).toContain("/features");
    // Every registered command has to be in the prompt's list, or the model
    // will tell a user a real command does not exist.
    for (const command of SLASH_COMMANDS) {
      expect(prompt, `/${command.cmd} missing from the prompt`).toContain(
        `/${command.cmd}`,
      );
    }
  });
});

describe("the retrieval index covers the feature inventory", () => {
  it("indexes features-knowledge.md and maps it to /features", () => {
    const index = JSON.parse(
      readFileSync(
        join(process.cwd(), "lib", "ai", "knowledge-index.json"),
        "utf8",
      ),
    ) as { files: { file: string; cmd: string }[]; sections: unknown[] };
    const entry = index.files.find((f) => f.file === "features-knowledge.md");
    expect(entry).toBeDefined();
    expect(entry!.cmd).toBe("features");
    expect(index.sections.length).toBeGreaterThan(100);
  });

  it("indexes only files that exist, under a command that exists", () => {
    const index = JSON.parse(
      readFileSync(
        join(process.cwd(), "lib", "ai", "knowledge-index.json"),
        "utf8",
      ),
    ) as { files: { file: string; cmd: string }[] };
    const commands = new Set(SLASH_COMMANDS.map((c) => c.cmd));
    for (const source of index.files) {
      expect(existsSync(join(process.cwd(), "lib", "ai", source.file))).toBe(
        true,
      );
      expect(commands.has(source.cmd), `/${source.cmd} is not a command`).toBe(
        true,
      );
    }
  });
});
