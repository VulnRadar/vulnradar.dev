import { describe, it, expect } from "vitest";
import { htmlToText } from "@/lib/email/html-to-text";
import {
  emailBulletList,
  emailButton,
  emailHeading,
  emailLead,
  emailLink,
  emailParagraph,
} from "@/lib/email/layout";

/**
 * The plain-text part of a broadcast. It used to be the HTML with every
 * `<...>` run deleted, which left it a different message from the HTML part:
 * entities still encoded, list items run together, a button label twice, and
 * every URL gone with its href.
 */
describe("htmlToText", () => {
  it("decodes named and numeric entities", () => {
    expect(
      htmlToText(
        "<p>It&#39;s faster &amp; safer &mdash; &quot;really&quot;&nbsp;now.</p>",
      ),
    ).toBe('It\'s faster & safer \u2014 "really" now.');
    expect(htmlToText("<p>&#x41;&#66; &lt;tag&gt;</p>")).toBe("AB <tag>");
  });

  it("leaves an unknown entity alone and drops an impossible code point", () => {
    expect(htmlToText("<p>&notanentity; and &#0; and &#xD800;</p>")).toBe(
      "&notanentity; and and",
    );
  });

  it("breaks lines at block elements and list items, so nothing runs together", () => {
    expect(
      htmlToText(
        "<h2>Title</h2><p>First.</p><p>Second.</p><ul><li>One</li><li>Two</li></ul><div>Tail</div>",
      ),
    ).toBe("Title\n\nFirst.\n\nSecond.\n\n- One\n- Two\n\nTail");
  });

  it("turns a <br> into a line break and collapses source whitespace", () => {
    expect(htmlToText("<p>one\n      two<br>three<br />four</p>")).toBe(
      "one two\nthree\nfour",
    );
  });

  it("keeps table cells apart and starts each row on its own line", () => {
    expect(
      htmlToText(
        "<table><tr><td>Name</td><td>Sam</td></tr><tr><td>Plan</td><td>Free</td></tr></table>",
      ),
    ).toBe("Name Sam\nPlan Free");
  });

  it("writes a link's address after its label", () => {
    expect(
      htmlToText(
        '<p>Read the <a href="https://example.com/docs">docs</a> first.</p>',
      ),
    ).toBe("Read the docs (https://example.com/docs) first.");
  });

  it("does not repeat an address that is already the link text", () => {
    expect(
      htmlToText('<a href="https://example.com/x">https://example.com/x</a>'),
    ).toBe("https://example.com/x");
    expect(
      htmlToText('<a href="https://example.com/x/">example.com/x</a>'),
    ).toBe("example.com/x");
  });

  it("prints the address of a link with no text, and prints a mailto as the bare address", () => {
    expect(htmlToText('<a href="https://example.com/x"></a>')).toBe(
      "https://example.com/x",
    );
    expect(
      htmlToText('<a href="mailto:help@example.com?subject=hi">Email us</a>'),
    ).toBe("Email us (help@example.com)");
  });

  it("drops anchors and script links, which have no address worth printing", () => {
    expect(htmlToText('<a href="#top">Back to top</a>')).toBe("Back to top");
    expect(htmlToText('<a href="javascript:alert(1)">Click</a>')).toBe("Click");
  });

  it("decodes entities inside an href before printing it", () => {
    expect(
      htmlToText('<a href="https://example.com/?a=1&amp;b=2">Go</a>'),
    ).toBe("Go (https://example.com/?a=1&b=2)");
  });

  it("skips Outlook's conditional blocks, so a button label appears once", () => {
    const html = emailButton("https://example.com/scan", "Run a scan");
    const text = htmlToText(html);
    expect(text.match(/Run a scan/g)).toHaveLength(1);
    expect(text).toBe("Run a scan (https://example.com/scan)");
  });

  it("drops <style>, <script> and <head> wholesale", () => {
    expect(
      htmlToText(
        "<html><head><title>T</title><style>p{color:red}</style></head><body><p>Hi</p><script>alert(1)</script></body></html>",
      ),
    ).toBe("Hi");
  });

  it("drops comments and a doctype", () => {
    expect(htmlToText("<!DOCTYPE html><!-- note --><p>Kept</p>")).toBe("Kept");
  });

  it("keeps a lone angle bracket that opens no tag", () => {
    expect(htmlToText("<p>price < 10 and 5 > 3</p>")).toBe(
      "price < 10 and 5 > 3",
    );
  });

  it("drops the zero-width filler a hidden preheader is padded with", () => {
    expect(
      htmlToText(`<div>Preview&#8199;&#65279;&#8199;&#65279;</div><p>Body</p>`),
    ).toBe("Preview\n\nBody");
  });

  it("turns a real campaign-style fragment into the message a text reader would want", () => {
    const html = [
      emailHeading("Release notes"),
      emailLead("We didn't break anything &amp; it's faster."),
      emailBulletList(["Scans are quicker", "DNSSEC is reported"]),
      emailParagraph(
        `See ${emailLink("https://example.com/changelog", "the changelog")}.`,
      ),
      emailButton("https://example.com/scan", "Run a scan"),
    ].join("");
    expect(htmlToText(html)).toBe(
      [
        "Release notes",
        "We didn't break anything & it's faster.",
        "- Scans are quicker\n- DNSSEC is reported",
        "See the changelog (https://example.com/changelog).",
        "Run a scan (https://example.com/scan)",
      ].join("\n\n"),
    );
  });

  describe("on hostile or broken input", () => {
    it("stays linear on a long run of opening brackets", () => {
      const input = "<".repeat(200_000) + "x";
      const started = performance.now();
      expect(htmlToText(input)).toBe(input);
      expect(performance.now() - started).toBeLessThan(500);
    });

    it("stays fast on thousands of unterminated tags with an open quote in each", () => {
      const input = '<a "'.repeat(30_000) + ">";
      const started = performance.now();
      htmlToText(input);
      expect(performance.now() - started).toBeLessThan(2_000);
    });

    it("ends the message at a tag still open after the tag-length cap", () => {
      // Reading on from the next "<" rescanned the cap for every broken tag,
      // which is what made the case above take seconds on a slow machine.
      expect(
        htmlToText('<p>Hello</p><a "' + "x".repeat(5_000) + ">world"),
      ).toBe("Hello");
      // One that runs into the end of the document is just text.
      expect(htmlToText("<p>Hi</p>a <b")).toBe("Hi\n\na <b");
    });

    it("treats an unterminated comment or tag as the end of the message", () => {
      expect(htmlToText("<p>Before</p><!-- never closed <p>After</p>")).toBe(
        "Before",
      );
      expect(htmlToText("<p>Before</p><style>p{}")).toBe("Before");
    });

    it("never emits markup from escaped text, so the output is safe as text/plain", () => {
      expect(htmlToText("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe(
        "<script>alert(1)</script>",
      );
    });
  });
});
