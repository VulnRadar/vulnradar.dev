import { APP_URL, ROUTES, SEO_GITHUB_URL } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";

// RFC 9116 (https://www.rfc-editor.org/rfc/rfc9116). This is the single
// source of truth for security.txt: next.config.mjs rewrites both
// /.well-known/security.txt and /security.txt here. There used to also
// be a static public/.well-known/security.txt file, but Next.js serves
// files under public/ before applying rewrites, so that static file was
// silently shadowing this route for the canonical .well-known path
// (only /security.txt, which has no static file, ever reached this
// handler). It's been removed so both paths return this same content.
//
// No `Encryption` field: there is no PGP/GPG key for SECURITY_EMAIL
// anywhere in this repo (checked SECURITY.md, .env.example, and every
// "PGP"/"GPG"/".asc" reference). Do not add one until a maintainer
// actually generates a keypair and publishes the public key somewhere
// verifiable -- a fabricated key would be worse than no key at all.
/**
 * RFC 9116 requires Expires and says a file past it should not be used, so a
 * date written into the source is a promise that every deployment eventually
 * breaks: the file keeps being served, researchers are told to distrust it,
 * and nothing anywhere reports that the disclosure channel has closed. This
 * one was 2027-06-30, which would have quietly invalidated the security.txt
 * of every self-hosted copy on the same day.
 *
 * Computed per request instead, a year out, which is the longest the RFC's
 * own guidance suggests. The response is cached for a day, so the value moves
 * forward daily and is never within a day of lapsing.
 */
function expiresOneYearFromNow(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCMilliseconds(0);
  return d.toISOString();
}

export async function GET() {
  const securityEmail = await getSetting("SECURITY_EMAIL");
  const body = `Contact: mailto:${securityEmail}
Contact: ${APP_URL}${ROUTES.CONTACT}
Expires: ${expiresOneYearFromNow()}
Preferred-Languages: en
Canonical: ${APP_URL}/.well-known/security.txt
Policy: ${SEO_GITHUB_URL}/blob/main/SECURITY.md
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
