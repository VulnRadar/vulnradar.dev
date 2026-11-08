/**
 * The Developer tab's save for a webhook edit. Source-text, as the other
 * profile wiring tests are: the shell needs a whole session to mount, and the
 * thing that matters is what goes in the PATCH body.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SHELL = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../components/profile/tabs/profile-developer-tab.tsx",
  ),
  "utf8",
);

const start = SHELL.indexOf("async function handleSaveWebhookEdit");
const save = SHELL.slice(start, start + 1000);

describe("handleSaveWebhookEdit", () => {
  it("takes a draft whose URL is optional", () => {
    expect(save).toContain("draft: { name: string; url?: string }");
  });

  it("sends url and type only when the draft has a URL", () => {
    // A co-member's rename must not carry either key: PATCH answers 403 to a
    // non-owner who sends them, even unchanged.
    expect(save).toMatch(
      /draft\.url === undefined\s*\?\s*\{ name: draft\.name \|\| "Default" \}/,
    );
  });
});
