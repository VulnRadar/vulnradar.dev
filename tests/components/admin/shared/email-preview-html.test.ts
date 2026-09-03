import { describe, it, expect } from "vitest";
import {
  blockRemoteContent,
  hasRemoteContent,
} from "@/components/admin/shared/email-preview-html";

/**
 * The remote-content gate on the admin email viewer.
 *
 * A logged email body is attacker-influenceable: it can carry a name someone
 * typed into a contact form, a URL they submitted, the text of their message.
 * A remote image in one is a beacon aimed at the account with the most
 * privilege in the product -- open the message and whoever chose the URL
 * learns the admin's IP, their user agent, and when they read it. Mail clients
 * ship with remote content off for exactly this, and so does this viewer.
 */
describe("hasRemoteContent", () => {
  it("finds an http image", () => {
    expect(hasRemoteContent('<img src="http://tracker.example/p.gif" />')).toBe(
      true,
    );
  });

  it("finds an https image", () => {
    expect(
      hasRemoteContent('<img src="https://tracker.example/p.gif" />'),
    ).toBe(true);
  });

  it("finds a CSS background url", () => {
    expect(
      hasRemoteContent(
        '<td style="background: #fff url(https://tracker.example/p.gif) no-repeat;">x</td>',
      ),
    ).toBe(true);
  });

  it("returns the same answer when asked twice", () => {
    // A /g regex reused through .test() carries lastIndex between calls and
    // alternates true/false on identical input. This viewer asks per render.
    const html = '<img src="https://tracker.example/p.gif" />';
    expect(hasRemoteContent(html)).toBe(true);
    expect(hasRemoteContent(html)).toBe(true);
  });

  it("ignores a message that fetches nothing", () => {
    expect(hasRemoteContent("<p>Your scan is complete.</p>")).toBe(false);
  });

  it("ignores an inlined data: image, which costs no request", () => {
    expect(hasRemoteContent('<img src="data:image/gif;base64,R0lGOD" />')).toBe(
      false,
    );
  });
});

describe("blockRemoteContent", () => {
  it("renames src so the browser never issues the request", () => {
    const result = blockRemoteContent(
      '<img src="https://tracker.example/p.gif" width="1" />',
    );
    expect(result).not.toMatch(/\ssrc\s*=/);
    expect(result).toContain('data-vr-blocked-src="https://tracker.example');
  });

  it("blocks srcset, background and poster too", () => {
    const result = blockRemoteContent(
      '<img srcset="https://a.example/x.png 2x" background="https://b.example/y.png" poster="https://c.example/z.png" />',
    );
    expect(result).toContain("data-vr-blocked-srcset");
    expect(result).toContain("data-vr-blocked-background");
    expect(result).toContain("data-vr-blocked-poster");
    expect(result).not.toMatch(/\ssrcset\s*=/);
  });

  it("neutralises a CSS background url", () => {
    const result = blockRemoteContent(
      '<td style="background: #fff url(https://tracker.example/p.gif) no-repeat;">x</td>',
    );
    expect(result).not.toContain("tracker.example");
    expect(result).toContain("background: #fff none no-repeat;");
  });

  it("blocks an unquoted src attribute", () => {
    const result = blockRemoteContent(
      "<img src=https://tracker.example/p.gif>",
    );
    expect(result).not.toMatch(/\ssrc\s*=/);
  });

  it("leaves an inlined data: image loading, since it reaches no network", () => {
    const html = '<img src="data:image/gif;base64,R0lGOD" />';
    expect(blockRemoteContent(html)).toBe(html);
  });

  it("changes nothing else about the document", () => {
    const html =
      '<table width="600" style="background-color: #0b0f19;"><tr><td>Hi</td></tr></table>';
    expect(blockRemoteContent(html)).toBe(html);
  });

  it("keeps the original URL available, so the viewer can offer to load it", () => {
    const result = blockRemoteContent(
      '<img src="https://vulnradar.dev/logo.svg" />',
    );
    expect(result).toContain("https://vulnradar.dev/logo.svg");
  });
});
