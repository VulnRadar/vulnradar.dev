import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_LOGO_URL } from "@/lib/config/config-values";
import { generateEmailPreviewHtml } from "@/components/admin/shared/email-preview-html";
import { EMAIL_LOGO_PATH, resolveEmailLogoSrc } from "@/lib/email/logo-src";

const APP = "https://scan.example.dev";

/**
 * The header mark of a real message and of the admin broadcast preview are one
 * decision. They used to be two: the mail swapped the default SVG favicon for
 * a PNG (Gmail and Outlook will not draw an SVG), the preview kept drawing the
 * SVG, so an admin signed off on a header the recipient did not get.
 */
describe("resolveEmailLogoSrc", () => {
  it("swaps the default logo, in any spelling of it, for the PNG", () => {
    expect(resolveEmailLogoSrc(CONFIG_LOGO_URL, APP)).toBe(
      `${APP}${EMAIL_LOGO_PATH}`,
    );
    expect(resolveEmailLogoSrc(`${APP}${CONFIG_LOGO_URL}`, APP)).toBe(
      `${APP}${EMAIL_LOGO_PATH}`,
    );
  });

  it("uses a logo an operator chose as written", () => {
    expect(
      resolveEmailLogoSrc("https://cdn.example.net/brand/mark.png", APP),
    ).toBe("https://cdn.example.net/brand/mark.png");
    expect(resolveEmailLogoSrc("/brand/mark.png", APP)).toBe(
      `${APP}/brand/mark.png`,
    );
  });

  it("makes a root-relative path absolute, which mail clients need", () => {
    expect(
      resolveEmailLogoSrc("/brand/mark.png", APP).startsWith("https://"),
    ).toBe(true);
  });

  it("points at a file that ships", () => {
    expect(existsSync(join(process.cwd(), "public", EMAIL_LOGO_PATH))).toBe(
      true,
    );
  });
});

describe("the broadcast preview's header mark", () => {
  const preview = (logoSrc?: string) =>
    generateEmailPreviewHtml({
      title: "Subject",
      bodyHtml: "<p>Body</p>",
      appName: "VulnRadar",
      appUrl: APP,
      logoSrc,
    });

  it("is the PNG real mail carries when the caller passes the default logo", () => {
    const html = preview(`${APP}${CONFIG_LOGO_URL}`);

    expect(html).toContain(`src="${APP}${EMAIL_LOGO_PATH}"`);
    expect(html).not.toContain("favicon.svg");
  });

  it("is the PNG when the caller passes nothing", () => {
    const html = preview();

    expect(html).toContain(`src="${APP}${EMAIL_LOGO_PATH}"`);
    expect(html).not.toContain("favicon.svg");
  });

  it("keeps a custom logo", () => {
    const html = preview("https://cdn.example.net/brand/mark.png");

    expect(html).toContain('src="https://cdn.example.net/brand/mark.png"');
    expect(html).not.toContain(EMAIL_LOGO_PATH);
  });

  it("agrees with the resolver for every input the mail would see", () => {
    for (const input of [
      CONFIG_LOGO_URL,
      `${APP}${CONFIG_LOGO_URL}`,
      "/brand/mark.png",
      "https://cdn.example.net/brand/mark.png",
    ]) {
      expect(preview(input)).toContain(
        `src="${resolveEmailLogoSrc(input, APP)}"`,
      );
    }
  });
});
