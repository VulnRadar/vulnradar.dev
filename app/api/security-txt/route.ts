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
export async function GET() {
  const securityEmail = await getSetting("SECURITY_EMAIL");
  const body = `Contact: mailto:${securityEmail}
Contact: ${APP_URL}${ROUTES.CONTACT}
Expires: 2027-06-30T00:00:00.000Z
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
