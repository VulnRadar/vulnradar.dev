import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Source code does not spell an API path out.
 *
 * Every request the web app makes goes through the API map in
 * lib/config/client-constants.ts, and every URL that has to stay put goes
 * through FROZEN in lib/api/frozen-paths.ts. A string or template literal that
 * contains `/api/v<digit>` or `/api/internal` anywhere else is a copy of a fact
 * that has one home, and the copy is what goes stale when a route moves: the
 * compiler cannot see it and no test fails, the request just starts asking for
 * a path nothing answers. The ESLint rule that warns on a literal inside
 * `fetch()` covered one spelling of this; 12 call sites had it, and the rule
 * could not see `useSWR(...)`, `apiGet(...)` or a URL assigned to a variable
 * first.
 *
 * Parsed with the TypeScript compiler, so comments are exempt (they are
 * allowed to say where a route lives) and so is JSX text. Template literals are
 * read by their text parts, which means `/api/${API_VERSION}/x` is clean and
 * `${origin}/api/v3/x` is not.
 *
 * Two lists below. HOMES are the files whose job is to name paths, plus
 * strings that are not ours; they do not shrink. DEBT is every other file that
 * predates this test. It is keyed by file, so a literal added to a file that
 * is not listed fails even when its neighbours are listed. The one exception
 * is app/docs/ (a trailing slash means a directory), which the docs sweep
 * empties in one go. The last test fails when an entry no longer matches, so
 * fixing a file means deleting its line and the list can only shrink. Nothing
 * is added to it to make a new literal pass: use the API map.
 */

const ROOT = path.resolve(__dirname, "../..");

const SCAN_DIRS = [
  "app",
  "components",
  "hooks",
  "lib",
  "scripts",
  "cli",
  "extension/src",
];
const SCAN_FILES = ["middleware.ts", "instrumentation.ts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "tests"]);
const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(?:test|spec)\./;
const API_PATH = /\/api\/(?:v\d|internal)/;

interface Literal {
  line: number;
  text: string;
}

/** Every string or template literal in `source` that names an API path. */
function apiPathLiterals(source: string, fileName: string): Literal[] {
  const kind = /\.(?:tsx|jsx)$/.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.(?:js|mjs|cjs)$/.test(fileName)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const found: Literal[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (API_PATH.test(node.text)) {
        found.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          text: node.text,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Files whose job is to name paths, and strings that are another service's. */
const HOMES: Record<string, string> = {
  "lib/config/client-constants.ts": "the API map",
  "lib/config/config-values.ts": "the internal prefix constant",
  "lib/api/route-registry.ts": "the route registry names every path",
  "lib/api/frozen-paths.ts": "URLs that live outside this repository",
  "lib/api/versions.ts": "reads the version off the URL",
  "lib/changelog/data.ts": "release notes quote the URLs of their time",
  "lib/ai/model-catalog.ts": "OpenRouter's API, not ours",
  "lib/ai/provider.ts": "OpenRouter's API, not ours",
  "lib/scanner/subdomain-discovery-engine.ts": "OTX and urlscan APIs, not ours",
  "scripts/spike/":
    "the routing spike drives a fixture app with the exact paths it proves",
};

/** Literals that predate this test. Delete a line when its file is clean. */
const DEBT: Record<string, string> = {
  "app/api/v3/account/github/connect/route.ts":
    "OAuth redirect URI; moves onto FROZEN.OAUTH_CALLBACK",
  "app/api/v3/auth/discord/callback/route.ts":
    "OAuth redirect URI; moves onto FROZEN.DISCORD_CALLBACK",
  "app/api/v3/auth/discord/route.ts":
    "OAuth redirect URI; moves onto FROZEN.DISCORD_CALLBACK",
  "app/api/v3/auth/oauth/[provider]/callback/route.ts":
    "OAuth redirect URIs; move onto FROZEN.OAUTH_CALLBACK",
  "app/api/v3/auth/oauth/[provider]/route.ts":
    "OAuth redirect URI and an error sentence naming a route",
  "app/api/v3/auth/staff-oidc/callback/route.ts":
    "OAuth redirect URI; moves onto FROZEN.STAFF_OIDC_CALLBACK",
  "app/api/v3/auth/staff-oidc/route.ts":
    "OAuth redirect URI; moves onto FROZEN.STAFF_OIDC_CALLBACK",
  "app/api/v3/stripe/setup-webhook/route.ts":
    "the registered webhook URL; moves onto FROZEN.STRIPE_WEBHOOK",
  "app/docs/":
    "documentation samples; the docs sweep moves them onto apiPath()",
  "app/host/[hostname]/page.tsx": "type import of the route module's path",
  "components/host/danger-score-trend-utils.ts":
    "type import of the route module's path",
  "components/host/danger-score-trend.tsx":
    "type import of the route module's path",
  "components/admin/features/engine-feedback-manager.tsx":
    "an empty-state sentence naming a route",
  "components/landing/landing-api-example.tsx": "the marketing request sample",
  "components/landing/landing-features.tsx": "marketing copy naming a route",
  "extension/src/lib/api.ts":
    "the extension's request paths; ext-v4-migration moves them",
  "extension/src/onboarding/welcome.ts":
    "onboarding copy naming a route; ext-v4-migration moves it",
  "cli/lib.mjs": "the CLI's default base URL; cli-v4-native moves it",
  "lib/ai/system-prompt.ts": "the assistant's summary of the public API",
  "lib/api/openapi-spec.ts": "the document's servers entry",
  "lib/billing/stripe-webhook-setup.ts": "the registered webhook URL",
  "lib/config/registry.ts": "setting help text that names routes",
  "lib/database/schema/01-core.mjs": "SQL comments that name route files",
  "lib/uploads/avatar-migration.ts": "stored avatar paths",
  "lib/uploads/avatar-storage.ts": "stored avatar paths",
  "lib/uploads/team-avatar-storage.ts": "stored team avatar paths",
  "middleware.ts": "the path rules; mw-hardening moves them onto the registry",
  "scripts/_lib/_lib.app-enums.mjs": "report text naming route files",
  "scripts/_lib/_lib.check-cross-column.mjs": "report text naming route files",
  "scripts/_lib/_lib.encrypted-columns.mjs": "report text naming route files",
  "scripts/maintenance/migrate-avatars-to-files.mjs": "stored avatar paths",
};

function matchesEntry(file: string, entry: string): boolean {
  return entry.endsWith("/") ? file.startsWith(entry) : file === entry;
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(rel, out);
    } else if (SOURCE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(rel);
    }
  }
}

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) walk(dir, out);
  for (const file of SCAN_FILES) {
    if (fs.existsSync(path.join(ROOT, file))) out.push(file);
  }
  return out.sort();
}

let scanned: { files: string[]; literals: Map<string, Literal[]> } | null =
  null;

/** Every scanned file, and for the ones that have any, their literals. */
function scan() {
  if (scanned) return scanned;
  const files = sourceFiles();
  const literals = new Map<string, Literal[]>();
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (!API_PATH.test(text)) continue;
    const found = apiPathLiterals(text, file);
    if (found.length > 0) literals.set(file, found);
  }
  scanned = { files, literals };
  return scanned;
}

describe("apiPathLiterals", () => {
  it("flags a string, a template and each part of a template", () => {
    expect(apiPathLiterals(`fetch("/api/v3/scan");`, "a.ts")).toHaveLength(1);
    expect(apiPathLiterals("fetch(`/api/v3/scan`);", "a.ts")).toHaveLength(1);
    expect(
      apiPathLiterals("const u = `${origin}/api/v4/scan/${id}`;", "a.ts"),
    ).toHaveLength(1);
    expect(
      apiPathLiterals("const u = `${a}/api/v3/x/${b}/api/internal/y`;", "a.ts"),
    ).toHaveLength(2);
  });

  it("flags the internal prefix as well as numbered versions", () => {
    expect(apiPathLiterals(`go("/api/internal/auth/me");`, "a.ts")).toEqual([
      { line: 1, text: "/api/internal/auth/me" },
    ]);
  });

  it("flags a path in a JSX attribute and in a .mjs file", () => {
    expect(
      apiPathLiterals(`const x = <img src="/api/v3/badge/t" />;`, "a.tsx"),
    ).toHaveLength(1);
    expect(
      apiPathLiterals(`export const U = "/api/v3";`, "a.mjs"),
    ).toHaveLength(1);
  });

  it("reports the line the literal starts on", () => {
    expect(
      apiPathLiterals(`const a = 1;\n\nconst b = "/api/v3/x";`, "a.ts"),
    ).toEqual([{ line: 3, text: "/api/v3/x" }]);
  });

  it("leaves comments, JSX text and the API map alone", () => {
    expect(
      apiPathLiterals(
        [
          "// POST /api/v3/scan",
          "/* GET /api/internal/x */",
          "const a = `/api/${API_VERSION}/scan`;",
          "const b = API.SCAN;",
          'const c = "/api/version";',
          "const d = <code>/api/v3/auth/me</code>;",
        ].join("\n"),
        "a.tsx",
      ),
    ).toEqual([]);
  });
});

describe("no source file spells an API path", () => {
  // Reads every source file under the scanned roots, so it is I/O bound and
  // the default 5 s limit is tight on a busy machine.
  const SLOW = { timeout: 30_000 };

  it("finds files to check", SLOW, () => {
    expect(scan().files.length).toBeGreaterThan(500);
    expect(scan().literals.size).toBeGreaterThan(10);
  });

  it("outside the lists above", SLOW, () => {
    const listed = (file: string, list: Record<string, string>) =>
      Object.keys(list).some((entry) => matchesEntry(file, entry));
    const offenders = [...scan().literals]
      .filter(([file]) => !listed(file, HOMES) && !listed(file, DEBT))
      .flatMap(([file, found]) =>
        found.map(
          (l) => `${file}:${l.line}  ${JSON.stringify(l.text.slice(0, 80))}`,
        ),
      );
    expect(
      offenders,
      "build the path from the API map (lib/config/client-constants.ts), or from FROZEN (lib/api/frozen-paths.ts) for a URL that must never move",
    ).toEqual([]);
  });

  it("keeps the debt list honest", SLOW, () => {
    const files = [...scan().literals.keys()];
    const fixed = Object.keys(DEBT).filter(
      (entry) => !files.some((f) => matchesEntry(f, entry)),
    );
    expect(
      fixed,
      "nothing under these entries spells an API path any more: delete them from DEBT",
    ).toEqual([]);
  });

  it("keeps a file out of both lists", () => {
    const both = Object.keys(DEBT).filter((entry) =>
      Object.keys(HOMES).some((home) => matchesEntry(entry, home)),
    );
    expect(both).toEqual([]);
  });
});
