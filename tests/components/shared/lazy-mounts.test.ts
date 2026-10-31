import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What the root layout is allowed to pull into every route's entry chunk.
 *
 * app/layout.tsx wraps ~790 routes, so whatever it imports statically is
 * downloaded, parsed and hydrated by an anonymous visitor to a marketing page
 * as much as by anyone who will use it. The command palette (cmdk and a dialog
 * layer, opened only on Cmd/Ctrl+K), the two OAuth profile prompts (only after
 * a redirect carrying their parameters), the terms modal (only for an account
 * with terms to accept) and the backup-code reminder (only for an account whose
 * codes are unreadable) were all static imports. Each is now behind a small
 * gate that imports the real surface on demand.
 *
 * The first block walks the real static import graph from the layout, which is
 * the closest thing to the entry chunk that can be checked without a build.
 * The rest pin each gate's trigger.
 *
 * Source-text assertions, like the rest of tests/components: tsconfig keeps
 * `jsx: preserve`, so a .tsx component cannot be imported into a test.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ─── The static import graph ────────────────────────────────────────────

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) {
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(from), spec),
    );
  } else return null; // a package
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    const abs = path.join(ROOT, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return candidate;
  }
  return null;
}

/**
 * `import x from "y"`, `import "y"` and `export ... from "y"`: the edges that
 * put a module in the same chunk. `import type` is erased at build, and
 * `import("y")` is a dynamic import, which is a chunk boundary and exactly what
 * these gates are for, so neither counts.
 */
function staticImports(rel: string): string[] {
  const src = code(rel);
  const out: string[] = [];
  const re =
    /(?:^|\n)\s*(?:import|export)\s+(?!type\b)([^;]*?)\bfrom\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const spec = m[2] ?? m[3];
    const resolved = resolveImport(rel, spec);
    if (resolved) out.push(resolved);
  }
  return out;
}

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const next = queue.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const dep of staticImports(next)) queue.push(dep);
  }
  return seen;
}

describe("the import walker", () => {
  it("follows a static import", () => {
    expect(
      reachableFrom("components/scanner/header.tsx").has(
        "components/shared/notification-center.tsx",
      ),
    ).toBe(true);
    expect(
      reachableFrom("components/shared/command-palette.tsx").has(
        "components/ui/command.tsx",
      ),
    ).toBe(true);
  });

  it("does not follow a dynamic import", () => {
    const graph = reachableFrom("components/shared/command-palette-mount.tsx");
    expect(graph.has("components/shared/command-palette.tsx")).toBe(false);
    expect(graph.has("components/ui/command.tsx")).toBe(false);
  });
});

describe("the root layout's static import graph", () => {
  const graph = reachableFrom("app/layout.tsx");

  it("is reading the real graph", () => {
    // If the walker silently found nothing, every "not in the graph" check
    // below would pass for the wrong reason.
    expect(graph.size).toBeGreaterThan(40);
    expect(graph.has("components/shared/command-palette-mount.tsx")).toBe(true);
    expect(graph.has("components/shared/backup-codes-mount.tsx")).toBe(true);
    expect(graph.has("components/shared/lazy-mount.tsx")).toBe(true);
    expect(graph.has("components/auth/tos-gate.tsx")).toBe(true);
    expect(graph.has("components/providers/auth-provider.tsx")).toBe(true);
  });

  it.each([
    ["the command palette", "components/shared/command-palette.tsx"],
    ["cmdk's wrapper", "components/ui/command.tsx"],
    ["the terms modal", "components/modals/tos-modal.tsx"],
    [
      "the Discord profile prompt",
      "components/modals/discord-profile-modal.tsx",
    ],
    ["the GitHub profile prompt", "components/modals/github-profile-modal.tsx"],
    ["the backup-code reminder", "components/shared/backup-codes-modal.tsx"],
    // The bell is the header's, and was dragged into the layout graph only
    // because the backup-code reminder lived in its module.
    ["the notification bell", "components/shared/notification-center.tsx"],
    ["the product tour", "components/shared/onboarding-tour.tsx"],
    // The step copy. tour-session.ts used to import it for one clamp, which
    // put every line of the tour's text in the layout chunk.
    ["the tour's step copy", "lib/tour/steps.ts"],
    ["the AI chat widget", "components/ai-chat/chat-widget.tsx"],
  ])("does not reach %s", (_name, file) => {
    expect(graph.has(file)).toBe(false);
  });
});

// ─── Each gate ──────────────────────────────────────────────────────────

describe("the layout mounts the gates, not the surfaces", () => {
  const layout = code("app/layout.tsx");

  it("mounts the palette and backup-code gates", () => {
    expect(layout).toContain("<CommandPaletteMount />");
    expect(layout).toContain("<BackupCodesMount />");
    expect(layout).not.toContain("<CommandPalette />");
    expect(layout).not.toContain("<BackupCodesModal />");
  });

  it("no longer imports from the notification module at all", () => {
    expect(layout).not.toContain("notification-center");
  });
});

describe("LazyMount", () => {
  const src = code("components/shared/lazy-mount.tsx");

  it("imports on demand, once, and keeps the component", () => {
    expect(src).toContain("if (!wanted || Component) return;");
    expect(src).toContain("setComponent(() => loaded)");
  });

  it("reports a chunk that fails to load instead of swallowing it", () => {
    expect(src).toMatch(/\.catch\(\(err: unknown\) => \{[\s\S]*console\.error/);
  });

  it("draws the caller's fallback when the import fails, and only then", () => {
    expect(src).toContain("fallback?: ReactNode");
    expect(src).toContain("if (!cancelled) setFailed(true)");
    expect(src).toContain("if (Component) return <Component");
    expect(src).toContain("return failed ? (fallback ?? null) : null");
  });
});

describe("the command palette loads on the first Cmd or Ctrl+K", () => {
  const mount = code("components/shared/command-palette-mount.tsx");
  const palette = code("components/shared/command-palette.tsx");

  it("listens for k with a modifier and swallows it", () => {
    expect(mount).toContain('e.key !== "k" && e.key !== "K"');
    expect(mount).toContain("!e.metaKey && !e.ctrlKey");
    expect(mount).toContain("e.preventDefault()");
  });

  it("imports the palette dynamically and only once asked", () => {
    expect(mount).toContain('import("@/components/shared/command-palette")');
    expect(mount).not.toMatch(
      /from\s+["']@\/components\/shared\/command-palette["']/,
    );
    expect(mount).toContain("wanted={asked}");
  });

  it("mounts it open, so the keystroke that asked for it is not lost", () => {
    expect(mount).toContain("componentProps={{ defaultOpen: true }}");
    expect(palette).toMatch(/defaultOpen = false/);
    expect(palette).toContain("useState(defaultOpen)");
  });

  it("does not close itself on the mount that opened it", () => {
    // An effect on [pathname] also runs once on mount, which would shut a
    // palette mounted open in the same commit.
    expect(palette).not.toMatch(
      /useEffect\(\(\) => \{[^}]*setOpen\(false\)[^}]*\}, \[pathname\]\)/,
    );
    expect(palette).toContain("seenPathname");
  });
});

describe("the backup-code reminder loads only for an account that needs it", () => {
  const mount = code("components/shared/backup-codes-mount.tsx");

  it("waits for a signed-in account with unreadable codes", () => {
    expect(mount).toContain("me?.userId && me.backupCodesInvalid");
    expect(mount).toContain('import("@/components/shared/backup-codes-modal")');
  });

  it("lives in its own file, out of the notification bell's module", () => {
    expect(code("components/shared/notification-center.tsx")).not.toContain(
      "BackupCodesModal",
    );
    expect(code("components/shared/backup-codes-modal.tsx")).toContain(
      "export function BackupCodesModal",
    );
    expect(code("components/shared/index.ts")).toContain(
      'export { BackupCodesModal } from "./backup-codes-modal"',
    );
  });
});

describe("the OAuth profile prompts load only on the redirect back", () => {
  it.each([
    ["discord", "Discord", "discord-profile-modal"],
    ["github", "GitHub", "github-profile-modal"],
  ])("%s", (provider, _label, file) => {
    const src = code(`components/modals/${provider}-profile-modal-wrapper.tsx`);
    expect(src).toContain(
      `searchParams.get("${provider}_connected") === "true"`,
    );
    expect(src).toContain(`searchParams.get("${provider}_username")`);
    expect(src).toContain(`import("./${file}")`);
    expect(src).not.toMatch(new RegExp(`from\\s+["']\\./${file}["']`));
    // useSearchParams needs a Suspense boundary above it.
    expect(src).toContain("<Suspense");
  });
});

describe("the terms modal loads only when acceptance is needed", () => {
  const src = code("components/auth/tos-gate.tsx");

  it("imports it dynamically, inside the branch that needs it", () => {
    expect(src).toContain('import("@/components/modals/tos-modal")');
    expect(src).not.toMatch(/from\s+["']@\/components\/modals\/tos-modal["']/);
    const needed = src.slice(
      src.indexOf('(status === "pending" || status === "needs_reaccept")'),
    );
    expect(needed).toContain("<LazyMount");
  });

  it("keeps the page behind it blurred and inert while the chunk loads", () => {
    expect(src).toContain("pointer-events-none select-none opacity-20 blur-xs");
  });

  it("offers a reload if the chunk never arrives, so the inert page is not a dead end", () => {
    // The page behind the gate cannot be clicked, so a modal that failed to
    // import would otherwise leave nothing on screen to press.
    const needed = src.slice(
      src.indexOf('(status === "pending" || status === "needs_reaccept")'),
    );
    expect(needed).toContain("fallback={<TermsDialogUnavailable />}");
    expect(src).toMatch(
      /function TermsDialogUnavailable\(\)[\s\S]*window\.location\.reload\(\)/,
    );
  });
});
