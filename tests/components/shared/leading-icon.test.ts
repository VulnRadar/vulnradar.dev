import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the one way an icon is allowed to sit beside text.
 *
 * The app wrote this by hand 43 times, always as `items-start` on the row plus
 * a fixed `mt-0.5` on the icon. 2px is the right nudge for exactly one pairing
 * (a 16px icon against 14px text in Tailwind's default 20px line box) and the
 * app used a dozen pairings, so the icons were never quite lined up anywhere.
 * <LeadingIcon> computes it instead, from the line box of the text it names.
 *
 * Source-text assertions, same reasoning as
 * tests/components/shared/mobile-layout-invariants.test.ts: vitest runs `node`,
 * there is no DOM and no layout engine to measure. What is worth pinning is the
 * class contract, and that is visible in the source.
 */

const ROOT = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const TSX = [
  ...walk(path.join(ROOT, "components")),
  ...walk(path.join(ROOT, "app")),
];

/**
 * The rewrite left five call sites alone on purpose, and each is a case
 * <LeadingIcon> genuinely does not model: three are not icons at all (two
 * loading skeletons and a Switch), and two carry their own props.
 */
const ALLOWED_HAND_NUDGES = [
  "components/auth/unsubscribe-skeleton.tsx",
  "components/contact/support-tickets.tsx",
  "components/scanner/share-modal.tsx",
  "components/scanner/software-inventory-panel.tsx",
  "app/tools/api-scanner/page.tsx",
  "app/unsubscribe/page.tsx",
];

describe("leading icons", () => {
  it("no new icon aligns itself with a hand-written margin nudge", () => {
    const offenders: string[] = [];

    for (const file of TSX) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (ALLOWED_HAND_NUDGES.includes(rel)) continue;

      const src = fs.readFileSync(file, "utf8");
      for (const [i, line] of src.split("\n").entries()) {
        const m = line.match(/className="([^"]*)"/);
        if (!m) continue;
        const tokens = m[1].split(/\s+/);
        // The signature of the pattern this replaced: a fixed vertical nudge
        // on something sized like an icon and held at its natural width.
        const nudged = tokens.includes("mt-0.5") || tokens.includes("mt-px");
        const iconSized =
          (tokens.includes("h-3.5") && tokens.includes("w-3.5")) ||
          (tokens.includes("h-4") && tokens.includes("w-4")) ||
          (tokens.includes("h-5") && tokens.includes("w-5"));
        if (nudged && iconSized && tokens.includes("shrink-0")) {
          offenders.push(`${rel}:${i + 1}`);
        }
      }
    }

    expect(
      offenders,
      `Use <LeadingIcon> instead of a hand-written mt-0.5 nudge:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("aligns to the first line of the text, not the middle of the block", () => {
    const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const util = css.slice(css.indexOf("@utility icon-lead"));
    const body = util.slice(0, util.indexOf("}\n\n"));
    // flex-start is what keeps the icon beside line one when the text wraps.
    // Without it a row set to items-center floats the icon down the block,
    // which is the half of this bug that is visible from across the room.
    expect(body).toContain("align-self: flex-start");
    expect(body).toContain("align-items: center");
  });

  it("builds its line box from a zero-width space, so there is no magic number", () => {
    const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const util = css.slice(css.indexOf("@utility icon-lead"));
    // The ZWSP becomes an anonymous flex item carrying the wrapper's own
    // font-size and line-height, so the flex line is exactly one line of that
    // text tall at any type scale.
    expect(util.slice(0, util.indexOf("}\n\n"))).toContain('content: "\\200b"');
  });

  it("sets its own type rather than inheriting it", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "components/shared/leading-icon.tsx"),
      "utf8",
    );
    // 38 of the 43 rows this replaced declare their type on the text CHILD and
    // not on the flex row, so a wrapper that inherited would build its line box
    // from text-base while the text beside it ran at text-sm, and land 3px low.
    expect(src).toContain("LINE_BOX[line]");
    expect(src).toMatch(/line\s*=\s*"sm"/);
  });
});
