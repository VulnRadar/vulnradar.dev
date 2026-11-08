import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A flex item's minimum width is its content, so a note holding one long URL
 * would not shrink and pushed /docs/api to a 431px layout viewport on a 360px
 * phone (research/mobile-ui.md, M2). The note and the error description are the
 * two free-text spans in the card that sit beside an icon or a badge.
 */
const ROOT = path.resolve(__dirname, "../../..");
const card = fs.readFileSync(
  path.join(ROOT, "components/docs/docs-endpoint-card.tsx"),
  "utf8",
);

function spanAround(expression: string): string {
  const at = card.indexOf(expression);
  expect(at, `${expression} is rendered by the card`).toBeGreaterThan(-1);
  return card.slice(card.lastIndexOf("<span", at), at);
}

describe("EndpointCard free-text wrapping", () => {
  it.each(["{note}", "{error.description}"])(
    "lets %s shrink and break inside its flex row",
    (expression) => {
      const span = spanAround(expression);
      expect(span).toContain("min-w-0");
      expect(span).toContain("wrap-break-word");
    },
  );

  it("is still needed: a real note carries an unbreakable token", () => {
    const api = fs.readFileSync(
      path.join(ROOT, "app/docs/api/page.tsx"),
      "utf8",
    );
    const longTokens = [...api.matchAll(/notes: \[([\s\S]*?)\n\s*\],/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter((token) => token.length > 40);
    expect(longTokens.length).toBeGreaterThan(0);
  });
});
