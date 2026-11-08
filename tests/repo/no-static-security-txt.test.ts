import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Next.js serves public/ before it applies rewrites, so a static security.txt
 * wins over app/api/security-txt on its path without any error. That already
 * happened once: the route's comment said the file was gone while the file sat
 * there with its own Expires and policy, and because the image copies public/,
 * every self-hosted instance handed researchers upstream's contact address
 * instead of its own SECURITY_EMAIL.
 */
const ROOT = path.resolve(__dirname, "../..");

describe("security.txt has one source", () => {
  it.each(["public/.well-known/security.txt", "public/security.txt"])(
    "%s stays gone",
    (file) => {
      expect(existsSync(path.join(ROOT, file))).toBe(false);
    },
  );

  it("keeps the MTA-STS policy, which has to be a static file", () => {
    expect(existsSync(path.join(ROOT, "public/.well-known/mta-sts.txt"))).toBe(
      true,
    );
  });

  it("rewrites both standard paths to the route", () => {
    const config = readFileSync(path.join(ROOT, "next.config.mjs"), "utf8");
    for (const source of ["/.well-known/security.txt", "/security.txt"]) {
      expect(config).toMatch(
        new RegExp(
          `source: "${source.replace(/\./g, "\\.")}",\\s+destination: "/api/security-txt"`,
        ),
      );
    }
  });
});
