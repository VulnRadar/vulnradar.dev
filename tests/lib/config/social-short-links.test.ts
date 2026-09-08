/**
 * Every social link on the site points at a path of ours (/discord, /youtube,
 * /github) which middleware redirects to the real profile. The address is then
 * ours: it can be printed, pasted into a README or read out, and the
 * destination can change without chasing down everywhere the old one was
 * written.
 *
 * The one thing that must NOT follow the short link is schema.org's `sameAs`.
 * It asserts "this account is this organisation", so it has to name the
 * platform's own URL; pointing it at our own redirect would assert that we are
 * ourselves, and it is the single field an audit of this page family would
 * check.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SOCIAL_LINKS,
  SOCIAL_REDIRECTS,
  SOCIAL_PROFILE_URLS,
  socialPath,
} from "@/lib/config/client-constants";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("social short links", () => {
  it("gives every configured platform a path of ours", () => {
    expect(SOCIAL_LINKS.length).toBeGreaterThan(0);
    for (const link of SOCIAL_LINKS) {
      expect(link.path).toBe(socialPath(link.id));
      expect(link.path!.startsWith("/")).toBe(true);
    }
  });

  it("redirects each one to the real profile", () => {
    for (const link of SOCIAL_LINKS) {
      expect(SOCIAL_REDIRECTS[link.path!]).toBe(link.url);
      expect(SOCIAL_REDIRECTS[link.path!]).toMatch(/^https:\/\//);
    }
  });

  it("includes the repository, which is not a social account", () => {
    expect(SOCIAL_REDIRECTS["/github"]).toMatch(
      /^https:\/\/github\.com\/[^/]+\/[^/]+$/,
    );
    // ...and it stays out of sameAs, which is only for accounts that ARE us.
    expect(SOCIAL_PROFILE_URLS).not.toContain(SOCIAL_REDIRECTS["/github"]);
  });

  it("keeps sameAs on the real profile URLs, never our redirect", () => {
    for (const url of SOCIAL_PROFILE_URLS) {
      expect(url).toMatch(/^https:\/\//);
    }
    for (const link of SOCIAL_LINKS) {
      expect(SOCIAL_PROFILE_URLS).not.toContain(link.path);
    }
  });

  it("never maps a path a real page already owns", () => {
    // middleware runs before the routing table, so a collision would shadow a
    // page rather than 404 visibly.
    const appDirs = fs
      .readdirSync(path.join(ROOT, "app"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `/${e.name}`);
    for (const shortPath of Object.keys(SOCIAL_REDIRECTS)) {
      expect(
        appDirs,
        `${shortPath} would shadow the page at app${shortPath}`,
      ).not.toContain(shortPath);
    }
  });

  it("is resolved in middleware, before the auth redirect", () => {
    const middleware = read("middleware.ts");
    expect(middleware).toContain("SOCIAL_REDIRECTS");
    // 307 and not 308: the destination is somebody else's URL and the account
    // can move. A permanent redirect is cached indefinitely by browsers.
    expect(middleware).toMatch(/NextResponse\.redirect\(socialTarget, 307\)/);
    const socialAt = middleware.indexOf("SOCIAL_REDIRECTS[socialPathname]");
    const loginAt = middleware.indexOf("ROUTES.LOGIN");
    expect(socialAt).toBeGreaterThan(-1);
    if (loginAt > -1) expect(socialAt).toBeLessThan(loginAt);
  });

  it("is what the rendered links actually use", () => {
    const socialLinks = read("components/shared/social-links.tsx");
    expect(socialLinks).toContain("href={path ?? url}");
    const footer = read("components/scanner/footer.tsx");
    expect(footer).toContain('href="/github"');
  });

  it("stops shipping a raw address for Cloudflare to rewrite", () => {
    // Cloudflare's Email Address Obfuscation turns any address in the HTML
    // into /cdn-cgi/l/email-protection#<hex> and injects a decoder script with
    // no nonce. This app's CSP uses 'strict-dynamic', under which 'self' is
    // ignored and only nonced scripts run, so the decoder was blocked and the
    // footer's mail icon led to a Cloudflare error page on every page.
    const footer = read("components/scanner/footer.tsx");
    expect(footer).not.toContain("mailto:");
    expect(footer).toContain("href={ROUTES.CONTACT}");
  });
});
