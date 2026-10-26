import { describe, it, expect } from "vitest";
import { fetchCalls } from "@/tests/components/_fetch-calls";
import { API } from "@/lib/config/client-constants";
import { FROZEN } from "@/lib/api/frozen-paths";

/**
 * The unsubscribe page is opened from the link in a sent email, so the API it
 * calls is the one URL whose path was printed into mail already in inboxes. It
 * reads that URL from API.ACCOUNT_UNSUBSCRIBE, which is FROZEN.UNSUBSCRIBE, so
 * a later change to the API map cannot strand the page behind an old link.
 *
 * The page needs a DOM to click; its three requests are read from the syntax
 * tree: load the preferences, save one toggle, unsubscribe from everything.
 */
describe("unsubscribe page requests", () => {
  const calls = fetchCalls("app/unsubscribe/page.tsx");

  it("makes the three requests it has always made", () => {
    expect(calls).toHaveLength(3);
  });

  it("sends all of them to API.ACCOUNT_UNSUBSCRIBE with the token", () => {
    for (const call of calls) {
      expect(call.target).toMatch(
        /^`\$\{API\.ACCOUNT_UNSUBSCRIBE\}\?token=\$\{encodeURIComponent\(token\)\}/,
      );
    }
  });

  it("reads the preferences with a GET and saves them with a POST", () => {
    const [load, save, all] = calls;
    expect(load.options).toBe("");
    expect(save.options).toContain('method: "POST"');
    expect(save.options).toContain("prefs: updated");
    expect(all.target).toContain("&action=unsubscribe_all");
    expect(all.options).toContain('method: "POST"');
  });

  it("is the URL the emails carry", () => {
    expect(API.ACCOUNT_UNSUBSCRIBE).toBe(FROZEN.UNSUBSCRIBE);
  });
});
