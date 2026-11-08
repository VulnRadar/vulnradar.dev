import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const ADMIN_PAGE = fs.readFileSync(
  path.join(ROOT, "app/admin/page.tsx"),
  "utf8",
);

/**
 * The badge dialog's save sends one summary toast on its first PATCH and
 * `{ toast: false }` on the rest, as the fourth argument to onAction. The page
 * used to wrap handleAction in a three-argument arrow, which dropped that
 * argument, so every badge in the batch still raised its own toast.
 */
describe("admin page: UserDetailPanel onAction wiring", () => {
  it("hands the panel's toast options through to handleAction", () => {
    const start = ADMIN_PAGE.indexOf("<UserDetailPanel");
    expect(start).toBeGreaterThan(-1);
    const end = ADMIN_PAGE.indexOf(
      "/>",
      ADMIN_PAGE.indexOf("onAction=", start),
    );
    const props = ADMIN_PAGE.slice(start, end);
    const wiring = props.match(/onAction=\{([\s\S]*?)\}\s*$/m)?.[1] ?? "";
    const passesEverything =
      /^\s*handleAction\s*$/.test(wiring) ||
      /\(\s*userId\s*,\s*action\s*,\s*extra\s*,\s*options\s*\)\s*=>\s*handleAction\(\s*userId\s*,\s*action\s*,\s*extra\s*,\s*options\s*\)/.test(
        wiring,
      );
    expect(wiring).not.toBe("");
    expect(passesEverything).toBe(true);
  });
});
