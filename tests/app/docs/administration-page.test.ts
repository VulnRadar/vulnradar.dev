import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Cloudflare rewrites anything shaped like an email address on a proxied page
 * into a protected-email link, which turns a copied SQL sample into nonsense.
 * Samples on this page use a placeholder with no @ in it.
 */
describe("/docs/administration SQL samples", () => {
  it("never write out an email address", () => {
    const page = readFileSync("app/docs/administration/page.tsx", "utf8");
    expect(page).not.toMatch(/WHERE\s+email\s*=\s*(?:'|&apos;)[^'&]*@/i);
  });
});
