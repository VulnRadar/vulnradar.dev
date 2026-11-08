/**
 * The longest check cards, rendered through next/og and measured.
 *
 * The card is a space-between column, so content too tall for it does not clip
 * cleanly: it runs through the bottom padding and the footer line lands on top
 * of the chips. The PNG is still 1200x630 and the response still a 200, so
 * neither says anything. Only the pixels do.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { clampText } from "@/lib/seo/metadata";
import { getAllChecks, type SeoCheck } from "@/lib/seo/checks-content";

const CHECKS = getAllChecks();
const longest = (score: (c: SeoCheck) => number, from = CHECKS) =>
  [...from].sort((a, b) => score(b) - score(a)).slice(0, 2);

// The last two are the combination that overflows: a title just under the
// point where the headline font drops, with a description that fills the clamp.
const SAMPLES: SeoCheck[] = [
  ...new Map(
    [
      ...longest((c) => c.title.length),
      ...longest((c) => c.description.length),
      ...longest(
        (c) => c.title.length + clampText(c.description, 140).length,
        CHECKS.filter((c) => c.title.length <= 56),
      ),
    ].map((c) => [c.id, c]),
  ).values(),
];

const BOTTOM_MARGIN_ROWS = 40;
const MAX_FOOTER_ROWS = 40;
const MIN_FOOTER_GAP_ROWS = 8;

/** One flag per row: does it hold anything brighter than the background? */
async function inkRows(res: Response): Promise<boolean[]> {
  const png = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(png)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rows: boolean[] = [];
  for (let y = 0; y < info.height; y++) {
    let inked = false;
    for (let x = 0; x < info.width && !inked; x++) {
      // The dimmest text on the card is well above 100, and the gradient
      // background stays under 40.
      inked = data[y * info.width + x]! > 100;
    }
    rows.push(inked);
  }
  return rows;
}

describe("check social cards at the longest real lengths", () => {
  it.each(SAMPLES.map((c) => c.id))(
    "%s fits the card",
    async (id) => {
      const { default: card } =
        await import("@/app/checks/[id]/opengraph-image");
      const res = await card({ params: Promise.resolve({ id }) });
      expect(res.status).toBe(200);
      const rows = await inkRows(res);
      expect(rows).toHaveLength(630);

      expect(rows.slice(-BOTTOM_MARGIN_ROWS).some(Boolean)).toBe(false);

      // The footer is the last run of ink; clear space has to separate it
      // from the chips above.
      const footerEnd = rows.lastIndexOf(true);
      let footerStart = footerEnd;
      while (footerStart > 0 && rows[footerStart - 1]) footerStart--;
      expect(footerEnd - footerStart).toBeLessThan(MAX_FOOTER_ROWS);
      let gap = 0;
      for (let y = footerStart - 1; y >= 0 && !rows[y]; y--) gap++;
      expect(gap).toBeGreaterThanOrEqual(MIN_FOOTER_GAP_ROWS);
    },
    60_000,
  );
});
