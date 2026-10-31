import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VALID_TABS } from "@/components/admin/nav";
import {
  ADMIN_TAB_ALIASES,
  resolveAdminTab,
} from "@/components/admin/tab-aliases";

const ROOT = path.resolve(__dirname, "../../..");
const ADMIN_PAGE = fs.readFileSync(
  path.join(ROOT, "app/admin/page.tsx"),
  "utf8",
);

/**
 * The contact-form alert email linked to /admin?tab=support&view=contact, and
 * the admin page routes on `support-tickets`. Anything it does not recognise
 * leaves the panel on Overview, so every copy of that mail already sitting in a
 * staff inbox opened the wrong page.
 */
describe("resolveAdminTab", () => {
  it("sends the old support id to the support-tickets tab", () => {
    expect(resolveAdminTab("support")).toBe("support-tickets");
  });

  it("leaves every real tab id alone", () => {
    for (const tab of VALID_TABS) {
      expect(resolveAdminTab(tab)).toBe(tab);
    }
  });

  it("returns nothing for no tab, and an unknown id as it came", () => {
    expect(resolveAdminTab(undefined)).toBeUndefined();
    expect(resolveAdminTab("")).toBe("");
    expect(resolveAdminTab("not-a-tab")).toBe("not-a-tab");
  });

  it("does not read inherited object keys as aliases", () => {
    expect(resolveAdminTab("constructor")).toBe("constructor");
    expect(resolveAdminTab("__proto__")).toBe("__proto__");
    expect(resolveAdminTab("toString")).toBe("toString");
  });

  it("only maps onto tabs that exist", () => {
    for (const target of Object.values(ADMIN_TAB_ALIASES)) {
      expect(VALID_TABS).toContain(target);
    }
  });

  it("never lets an alias shadow a real tab id", () => {
    for (const alias of Object.keys(ADMIN_TAB_ALIASES)) {
      expect(VALID_TABS as readonly string[]).not.toContain(alias);
    }
  });
});

describe("the admin page's use of it", () => {
  it("resolves ?tab= through the alias table before checking it against VALID_TABS", () => {
    expect(ADMIN_PAGE).toContain(
      'import { resolveAdminTab } from "@/components/admin/tab-aliases";',
    );
    expect(ADMIN_PAGE).toContain("const tab = resolveAdminTab(params.tab);");
    expect(ADMIN_PAGE).not.toContain("const tab = params.tab;");
  });

  it("rewrites the address bar to the real id and keeps the other parameters", () => {
    expect(ADMIN_PAGE).toContain("if (tab && tab !== params.tab) {");
    expect(ADMIN_PAGE).toContain(
      'setQueryParam("tab", tab, { replace: true });',
    );
  });
});
