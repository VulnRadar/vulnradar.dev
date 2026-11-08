import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * The copy rules for the docs, as a test, because a wrong sentence compiles
 * exactly like a right one. Comments are stripped first: this polices what a
 * reader sees, and "this used to say X" is how a comment explains a fix.
 *
 * ALLOWED is what the pages carried when the rule landed. It only shrinks: a
 * file may not exceed its count, and when a page is cleaned its row is lowered
 * or removed along with ALLOWED_TOTAL. A rule that is broken fails the build
 * as soon as a file goes over.
 */

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/ .*$/gm, "$1");
}

const RULES = {
  dash: /[–—·]/g,
  // A typed click path. DocsUiPath renders these from a table that a test
  // checks against the real tabs.
  typedUiPath: /Profile\s*(?:&gt;|>|\{" > "\})\s*[A-Z]/g,
  // Cloudflare's email obfuscation rewrites anything address-shaped in the
  // HTML, which turned SQL samples into "[email protected]". git@ is a remote.
  address: /(?<![\w.+-])(?!git@)[\w.+-]+@[a-z0-9-]+\.[a-z]{2,}\b/gi,
  // A reader needs what is true now, and the changelog holds what changed.
  revisionNarration: /\bthis used to\b|\bused to say\b|\bsince \d+\.\d+/gi,
} as const;

type Rule = keyof typeof RULES;

const ALLOWED: Partial<Record<`${Rule}:${string}`, number>> = {
  "typedUiPath:app/docs/account-security/page.tsx": 8,
  "typedUiPath:app/docs/ai/page.tsx": 3,
  "address:app/docs/api/page.tsx": 1,
  "revisionNarration:app/docs/api/page.tsx": 2,
  "typedUiPath:app/docs/api/playground/page.tsx": 1,
  "typedUiPath:app/docs/cli/page.tsx": 1,
  "typedUiPath:app/docs/config/page.tsx": 1,
  "revisionNarration:app/docs/config/page.tsx": 1,
  "address:app/docs/developers/page.tsx": 1,
  "typedUiPath:app/docs/github/page.tsx": 2,
  "typedUiPath:app/docs/page.tsx": 1,
  "revisionNarration:app/docs/rate-limits/page.tsx": 1,
  "address:app/docs/self-hosting/page.tsx": 8,
  "revisionNarration:app/docs/self-hosting/page.tsx": 1,
  "address:app/docs/setup/page.tsx": 1,
  "typedUiPath:app/docs/sharing/page.tsx": 2,
  "typedUiPath:app/docs/webhooks/page.tsx": 1,
};
const ALLOWED_TOTAL = 36;

const files = walk("app/docs");

function count(rule: Rule, file: string): number {
  const source = stripComments(readFileSync(path.join(ROOT, file), "utf8"));
  return (source.match(RULES[rule]) ?? []).length;
}

describe("docs copy rules", () => {
  it("has pages to read", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(Object.keys(RULES) as Rule[])(
    "%s stays within its allowance",
    (rule) => {
      const over: string[] = [];
      for (const file of files) {
        const found = count(rule, file);
        const allowed = ALLOWED[`${rule}:${file}`] ?? 0;
        if (found > allowed)
          over.push(`${file}: ${found} (allowed ${allowed})`);
      }
      expect(over).toEqual([]);
    },
  );

  it("only names files that exist", () => {
    for (const key of Object.keys(ALLOWED)) {
      const file = key.slice(key.indexOf(":") + 1);
      expect(files, key).toContain(file);
    }
  });

  it("the allowlist only shrinks", () => {
    const total = Object.values(ALLOWED).reduce<number>(
      (a, b) => a + (b ?? 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(ALLOWED_TOTAL);
  });
});

describe("the rules themselves", () => {
  const hits = (rule: Rule, text: string) =>
    (text.match(RULES[rule]) ?? []).length;

  it("catches the shapes they are for", () => {
    expect(hits("dash", "one — two – three · four")).toBe(3);
    expect(hits("typedUiPath", "Profile > Developer > API Keys")).toBe(1);
    expect(hits("typedUiPath", "Profile &gt; Developer")).toBe(1);
    expect(hits("address", "VALUES ('admin@example.com')")).toBe(1);
    expect(hits("revisionNarration", "This used to return 200")).toBe(1);
    expect(hits("revisionNarration", "Available since 3.8")).toBe(1);
  });

  it("leaves the look-alikes alone", () => {
    expect(hits("address", 'import x from "@/lib/x"')).toBe(0);
    expect(hits("address", "git@github.com:org/repo.git")).toBe(0);
    expect(hits("typedUiPath", "Your profile page")).toBe(0);
  });

  it("does not read comments", () => {
    expect(stripComments("// this used to say\nkept")).not.toContain("used to");
    expect(stripComments("{/* this used to say */}kept")).toBe("kept");
  });
});
