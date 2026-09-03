import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The containment around the admin email viewer.
 *
 * Admin > System > Email Logs renders a stored outbound message, and a stored
 * message is attacker-influenceable content: a name typed into a contact form,
 * a URL someone submitted, the text of their support request. It is displayed
 * to the account with the most privilege in the product, which makes it a
 * stored-XSS sink aimed at the best possible target.
 *
 * The containment is a sandboxed frame, and it only works if it stays exactly
 * as strict as it is:
 *
 *   sandbox=""            every restriction at once. No allow-scripts, so a
 *                         <script> in a logged body never executes. No
 *                         allow-same-origin, so the frame is an opaque origin
 *                         and cannot read the admin document, its cookies or
 *                         its storage even if something did run. An email has
 *                         no reason to script, and no mail client would let it.
 *   srcDoc                the document is handed to the frame, never spliced
 *                         into this one.
 *
 * dangerouslySetInnerHTML anywhere near this body would defeat all of it by
 * putting the markup straight into the admin origin.
 *
 * Source-text assertions on purpose: this suite runs in `node` with no DOM and
 * no testing-library (see vitest.config.ts), and what is worth pinning is the
 * attribute set on the element, which is visible in the source.
 */

const ROOT = path.resolve(__dirname, "../../../..");
const VIEWER = "components/admin/features/email-logs-manager.tsx";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Source with comments stripped, for the assertions that a name is *gone*.
 * The viewer carries a comment naming dangerouslySetInnerHTML as the thing not
 * to reach for, and matching that explanation would report the documentation
 * as the defect.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("admin email viewer containment", () => {
  const source = read(VIEWER);
  const stripped = code(VIEWER);

  it("renders the stored message through srcDoc, not into this document", () => {
    expect(stripped).toContain("srcDoc={frameHtml}");
  });

  it("gives the frame a fully restrictive sandbox", () => {
    expect(stripped).toMatch(/<iframe[\s\S]*?sandbox=""[\s\S]*?\/>/);
  });

  it("never grants the frame script execution", () => {
    expect(stripped).not.toContain("allow-scripts");
  });

  it("never grants the frame the admin origin", () => {
    expect(stripped).not.toContain("allow-same-origin");
  });

  it("grants the frame no sandbox token at all", () => {
    // Any non-empty sandbox value is a hole. The attribute exists to be empty.
    const sandboxValues = [...stripped.matchAll(/sandbox=(?:"([^"]*)"|\{)/g)];
    expect(sandboxValues.length).toBeGreaterThan(0);
    for (const match of sandboxValues) expect(match[1]).toBe("");
  });

  it("never puts a stored email body into the admin document as HTML", () => {
    expect(stripped).not.toContain("dangerouslySetInnerHTML");
  });

  it("blocks remote content before the frame sees it", () => {
    expect(stripped).toContain("blockRemoteContent(storedHtml)");
  });

  it("keeps the comment explaining why the sandbox is empty", () => {
    // The attribute is one token wide and looks like an oversight; the next
    // person to widen it should have to read why it is not.
    expect(source).toContain("allow-scripts");
    expect(source).toContain("allow-same-origin");
  });
});
