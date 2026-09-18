import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ADMIN_ACTIONS } from "@/lib/auth/permissions-client";

/**
 * The house rule, in the owner's words: a control that clears something, or
 * modifies data, asks first. On the user side and in the admin panel.
 *
 * Two things can be checked mechanically without guessing at intent, and both
 * are ways the rule has actually been broken before:
 *
 *   1. A native window.confirm/alert instead of the product's own dialog. One
 *      shipped in app/profile/page.tsx and was replaced the same night; it
 *      cannot be styled, it blocks the tab, and it reads as a browser warning
 *      rather than as part of the page.
 *   2. An admin action registered as `dangerous` but not as requiring
 *      confirmation. The registry is what the panel reads to decide whether a
 *      card is gated, so those two flags disagreeing is a gate that silently
 *      is not there.
 *
 * What cannot be checked here is "every mutating onClick has a dialog": the
 * call site can gate through a parent, a shared hook, a staged save, or a
 * password prompt, and a test that guessed would either miss most of them or
 * fail on all of them. That inventory is a review job, and
 * components/shared/use-confirm.tsx is what makes acting on it cheap.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const SCANNED = ["app", "components"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("confirm before mutating", () => {
  const files = SCANNED.flatMap((d) => sourceFiles(path.join(ROOT, d)));

  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("uses the product's dialog, never window.confirm or alert", () => {
    // Comments are allowed to mention them: one of them explains why the
    // native dialog was replaced.
    const offenders = files.filter((f) => {
      const source = readFileSync(f, "utf8");
      return source
        .split("\n")
        .some(
          (line) =>
            !line.trimStart().startsWith("//") &&
            !line.trimStart().startsWith("*") &&
            /(?:^|[^.\w])(?:window\.)?(?:confirm|alert)\s*\(\s*["'`]/.test(
              line,
            ),
        );
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("registers every dangerous admin action as needing confirmation", () => {
    const unguarded = ADMIN_ACTIONS.filter(
      (a) => a.dangerous && !a.requiresConfirmation,
    ).map((a) => a.id);
    expect(unguarded).toEqual([]);
  });
});
