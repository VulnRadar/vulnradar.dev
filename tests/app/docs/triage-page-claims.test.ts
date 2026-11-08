import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The tracking fields and the bulk controls moved off the page and into
 * dialogs, and /docs/triage went on describing the old layout: a sticky bar
 * holding the status, assignee and due date, and three fields that "appear"
 * once a finding leaves Open. The AI assistant answers from the text compiled
 * out of this page, so the stale copy reached it too. Both are checked.
 */
const flat = (path: string) =>
  readFileSync(path, "utf8").split(/\s+/).join(" ");

describe.each([
  ["the docs page", "app/docs/triage/page.tsx"],
  ["the assistant's compiled copy", "lib/ai/docs-knowledge.md"],
])("%s describes the dialogs", (_name, path) => {
  const text = flat(path);

  it("reaches the tracking fields through Add details or Edit details", () => {
    expect(text).not.toContain("three optional fields appear");
    expect(text).toContain("Add details");
    expect(text).toContain("Edit details");
    expect(text).toContain("It opens a dialog with three optional fields");
  });

  it("puts the bulk status, assignee and due date in the dialog", () => {
    expect(text).not.toContain("set them in the bar");
    expect(text).toContain("Set status opens a dialog");
    expect(text).toContain("set them in the dialog");
  });
});
