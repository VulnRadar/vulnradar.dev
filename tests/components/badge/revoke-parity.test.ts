/**
 * DELETE /api/v3/badge/site shipped with the badge feature and had no control
 * anywhere in the product, so the only way to stop a badge you had embedded on
 * a site you no longer own was to ask us. Same class as the webhook
 * rotate-secret and deliveries endpoints, and as the share-link duration that
 * the API accepted and the UI fixed.
 *
 * Source-text assertions: this Vitest config runs plain node with no jsdom, so
 * a `.tsx` cannot be rendered. What is worth pinning is that the control
 * exists, hits the right endpoint with the right parameter, warns about the
 * part that is not obvious, and leaves the page in a correct state afterwards.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const PREVIEW = read("components/badge/badge-preview.tsx");
const PAGE = read("app/badge/page.tsx");
const ROUTE = read("app/api/v3/badge/site/route.ts");

describe("a badge can be turned off from the badge page", () => {
  it("calls the endpoint that exists, with the parameter it wants", () => {
    // The route reads scanId from the query string and 400s without a
    // positive integer, so a body-shaped call would fail silently at the UI.
    expect(ROUTE).toContain("export async function DELETE");
    expect(ROUTE).toContain('searchParams.get("scanId")');
    expect(PREVIEW).toMatch(/API\.BADGE_SITE\}\?scanId=\$\{scanId\}/);
    expect(PREVIEW).toContain('method: "DELETE"');
  });

  it("confirms first, and says the part that is not obvious", () => {
    // Regenerating afterwards issues a new token, so a placed embed does not
    // come back. A button that only said "revoke" would not convey that.
    expect(ROUTE).toContain("badge_token = EXCLUDED.badge_token");
    expect(PREVIEW).toContain("<ConfirmDialog");
    expect(PREVIEW).toContain("danger");
    expect(PREVIEW).toMatch(/new address/);
  });

  it("surfaces a failure rather than just stopping the spinner", () => {
    // ConfirmDialog takes an error precisely because a rejected delete used
    // to look identical to a slow one.
    expect(PREVIEW).toContain("error={error}");
    expect(PREVIEW).toContain("busy={busy}");
  });

  it("leaves the page showing the truth after a revoke", () => {
    // The token is dead, so the preview must fall back to its generate state
    // rather than keep offering a snippet that no longer loads.
    expect(PAGE).toContain("function handleRevoked");
    expect(PAGE).toContain("site_badge_token: null");
    expect(PAGE).toContain("onRevoked={handleRevoked}");
  });
});
