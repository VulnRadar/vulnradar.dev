import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

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
 * The server drains for 30 seconds on a restart and PM2's default kill timeout
 * is 1.6, so a documented PM2 line without its own timeout cuts running scans
 * off. Searched rather than named: the setup page is moving.
 */
describe("the documented PM2 command", () => {
  function pages(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return pages(full);
      return entry.name === "page.tsx" ? [full] : [];
    });
  }

  it("waits as long as the compose stop grace period", () => {
    const grace = /stop_grace_period: (\d+)s/.exec(read("docker-compose.yml"));
    expect(grace).not.toBeNull();
    const lines = pages("app/docs")
      .flatMap((file) => read(file).split("\n"))
      .filter((line) => line.includes("pm2 start "));

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain(`--kill-timeout ${Number(grace![1]) * 1000}`);
    }
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
