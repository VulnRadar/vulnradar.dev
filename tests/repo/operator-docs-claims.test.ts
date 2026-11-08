import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");
// Sentences wrap across comment lines in .env.example and the Dockerfile.
const prose = (text: string) => text.replace(/\s*(?:\n#)?\s+/g, " ");

describe("what operators are told about restoring a backup", () => {
  it("says a backup carries its IV and auth tag, and who still needs a sidecar", () => {
    const text = prose(read(".env.example"));
    expect(text).toMatch(/A backup carries its IV and auth tag in its header/);
    expect(text).toMatch(/only older backups and db:migrate's pre-migration/);
    expect(text).not.toMatch(/\.enc file needs its \.json sidecar/);
  });
});

/**
 * lib/config/env.ts refuses to start when neither APP_URL nor
 * NEXT_PUBLIC_APP_URL is set, so a sentence promising what happens to reset
 * links in that state tells an operator to expect a running server that does
 * not exist.
 */
describe("what operators are told when no public URL is set", () => {
  it.each([".env.example", "Dockerfile", "app/docs/config/page.tsx"])(
    "%s says the server stops at boot and names the setting",
    (file) => {
      const text = prose(read(file));
      expect(text).toMatch(/stops at boot and names the setting/);
      expect(text).not.toMatch(
        /fall back to (<InlineCode>)?CONFIG_APP_URL|reset links would go/,
      );
    },
  );
});
