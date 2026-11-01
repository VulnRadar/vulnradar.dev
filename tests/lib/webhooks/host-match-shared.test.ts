import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { hostMatches } from "@/lib/net/host-match";
import { hostMatches as scannerHostMatches } from "@/lib/scanner/checks/_url-hosts";

/**
 * The webhook type detector and the scanner's host rules both ask "is this
 * hostname this domain, or a subdomain of it". They used to answer it with
 * two functions under two names (isHostOrSubdomain and hostMatches), so a fix
 * to one, such as the anchoring that keeps discord.com.evil.example out, had
 * to be found and repeated in the other. One function now answers it for
 * both.
 */
describe("one host-matching helper for webhooks and the scanner", () => {
  it("is the same function the scanner's host rules use", () => {
    expect(scannerHostMatches).toBe(hostMatches);
  });

  it("is what the webhook detector uses, not a local copy", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/webhooks/detect-type.ts"),
      "utf8",
    );
    expect(src).toMatch(/from "@\/lib\/net\/host-match"/);
    expect(src).not.toMatch(/\.endsWith\(/);
  });
});
