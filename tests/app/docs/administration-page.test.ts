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

describe("/docs/administration backup sidecar", () => {
  // /docs/config says the IV and tag travel inside the file. A callout here
  // telling operators every backup dies without its .json contradicted it.
  it("limits the sidecar warning to the files that still need one", () => {
    const page = readFileSync("app/docs/administration/page.tsx", "utf8")
      .replace(/\{" "\}/g, " ")
      .replace(/<\/?InlineCode>/g, "")
      .replace(/\s+/g, " ");
    expect(page).not.toContain("Keep the sidecar file");
    expect(page).toContain("in a header at the start of the file");
    expect(page).toContain("written before the header existed");
  });
});
