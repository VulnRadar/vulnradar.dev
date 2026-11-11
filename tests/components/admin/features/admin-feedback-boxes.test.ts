/**
 * Error, success and warning boxes in six admin managers go through
 * InlineAlert.
 *
 * Each had hand-rolled its own: border and fill opacities of /20, /25, /30
 * against /5 and /10, padding of p-3 or p-4, and no live role on the dynamic
 * ones, so a screen-reader admin who pressed Block and got a refusal heard
 * nothing. InlineAlert is one geometry with role="alert" or "status" by tone.
 *
 * The pattern is the one every hand-rolled copy used: a tinted border class
 * followed by the same tint as a fill. The one exception is listed with why.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const FILES = [
  "ip-rules-manager.tsx",
  "backup-manager.tsx",
  "queue-status-manager.tsx",
  "updater-manager.tsx",
  "email-logs-manager.tsx",
  "system-settings-manager.tsx",
];

const TINT = String.raw`(?:destructive|\[hsl\(var\(--(?:success|warning)\)\)\])`;
const HAND_ROLLED = new RegExp(
  String.raw`border-(?:2 border-)?${TINT}/\d+ bg-${TINT}/\d+`,
  "g",
);

/**
 * The Scanner Queue's failure list is a disclosure (a button header over
 * grouped rows), tinted when the engine failed. It is not a message box and
 * InlineAlert's single-paragraph shape does not fit it.
 */
const ALLOWED: Record<string, string[]> = {
  "queue-status-manager.tsx": ["border-destructive/25 bg-destructive/5"],
};

const source = (file: string) =>
  readFileSync(join(ROOT, "components/admin/features", file), "utf8");

describe("admin manager feedback boxes", () => {
  it.each(FILES)("%s has no hand-rolled tinted message box", (file) => {
    const found = source(file).match(HAND_ROLLED) ?? [];
    expect(found).toEqual(ALLOWED[file] ?? []);
  });

  it.each(FILES)("%s renders its messages through InlineAlert", (file) => {
    const text = source(file);
    expect(text).toContain(
      'import { InlineAlert } from "@/components/shared/inline-alert";',
    );
    expect(text).toMatch(/<InlineAlert\b/);
  });
});
