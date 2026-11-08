import { APP_URL, ROUTES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";

// RFC 9116 (https://www.rfc-editor.org/rfc/rfc9116). This is the single
// source of truth for security.txt: next.config.mjs rewrites both
// /.well-known/security.txt and /security.txt here. Next.js serves files
// under public/ before applying rewrites, so a static copy at
// public/.well-known/security.txt shadows this route on the canonical path,
// and every self-hosted image would hand out upstream's contact and policy
// instead of its own. tests/repo/no-static-security-txt.test.ts keeps the
// static file gone.
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
 * Computed per request instead, one day short of a year out, because the RFC
 * recommends a value less than a year in the future. The response is cached
 * for a day, so the value moves forward daily and is never close to lapsing.
 */
function expiresJustUnderOneYearFromNow(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCMilliseconds(0);
  return d.toISOString();
}

export async function GET() {
  const securityEmail = await getSetting("SECURITY_EMAIL");
  const body = `Contact: mailto:${securityEmail}
Contact: ${APP_URL}${ROUTES.CONTACT}
Expires: ${expiresJustUnderOneYearFromNow()}
Preferred-Languages: en
Canonical: ${APP_URL}/.well-known/security.txt
Policy: ${APP_URL}/security
Acknowledgments: ${APP_URL}${ROUTES.CHANGELOG}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
