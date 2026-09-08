/**
 * Our own replacement for Cloudflare's Email Address Obfuscation, which cannot
 * work here: Cloudflare rewrites addresses to /cdn-cgi/l/email-protection and
 * injects a decoder script carrying no nonce, while this app's CSP uses
 * 'strict-dynamic', under which browsers ignore 'self' and every host
 * allowlist and run only nonce-carrying scripts. Cloudflare documents no nonce
 * or integrity option, so there is nothing to allowlist: the only ways to run
 * their script are dropping 'strict-dynamic' or adding 'unsafe-inline'.
 *
 * The property worth guarding is not the mechanism but the outcome: no email
 * address reaches the served HTML. Source-text assertions, since this Vitest
 * config runs plain node with no jsdom.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const COMPONENT = read("components/shared/email-link.tsx");

/**
 * The one place a bare mailto is still correct: the share sheet opens the
 * visitor's mail client with a subject and body and NO recipient, so there is
 * no address in it to collect.
 */
const NO_RECIPIENT_MAILTO = ["components/scanner/share-modal.tsx"];

describe("EmailLink", () => {
  it("renders a contact route first and the address only after mount", () => {
    // The first render is the one that becomes HTML. If the address were in
    // it, every part of this would be pointless.
    expect(COMPONENT).toContain("if (!mounted) {");
    expect(COMPONENT).toContain("href={ROUTES.CONTACT}");
    expect(COMPONENT).toMatch(/const href = `mailto:\$\{address\}/);
  });

  it("degrades to a working link rather than a dead one without JavaScript", () => {
    // A harvester and a reader with JS off get the same thing, and it works.
    // Asserted against the pre-mount branch alone: the file's own doc comment
    // draws the before/after with the word mailto in it.
    const start = COMPONENT.indexOf("if (!mounted) {");
    const block = COMPONENT.slice(start, COMPONENT.indexOf("const href ="));
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("ROUTES.CONTACT");
    expect(block).not.toContain("mailto:");
  });

  it("escapes a prefilled subject", () => {
    expect(COMPONENT).toContain("encodeURIComponent(subject)");
  });

  it("leaves no bare mailto in the product", () => {
    // Every address-bearing link goes through this component now. A new bare
    // mailto is an address served in the HTML again.
    const offenders: string[] = [];
    for (const file of [
      ...walk(path.join(ROOT, "app")),
      ...walk(path.join(ROOT, "components")),
    ]) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (rel === "components/shared/email-link.tsx") continue;
      if (NO_RECIPIENT_MAILTO.includes(rel)) continue;
      const src = fs.readFileSync(file, "utf8");
      // `mailto:` immediately followed by something other than ? or ` is a
      // recipient. `mailto:?subject=` carries no address.
      if (/mailto:(?![?`'"])/.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      "These render an email address into the HTML. Use <EmailLink> so the " +
        "address only reaches an href after mount: " +
        offenders.join(", "),
    ).toEqual([]);
  });

  it("is used by the pages that used to carry addresses", () => {
    // The 16 links that were broken by Cloudflare's blocked decoder.
    for (const rel of [
      "app/legal/dmca/page.tsx",
      "app/legal/privacy/page.tsx",
      "app/legal/terms/page.tsx",
      "app/legal/disclaimer/page.tsx",
      "app/legal/acceptable-use/page.tsx",
      "app/legal/accessibility/page.tsx",
      "app/security/page.tsx",
      "components/contact/contact-quick-links.tsx",
    ]) {
      expect(read(rel), `${rel} should use EmailLink`).toContain("<EmailLink");
    }
  });
});
