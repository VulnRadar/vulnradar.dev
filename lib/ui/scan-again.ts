/**
 * A one-time grant to start a scan from a /dashboard?scan=<url> link.
 *
 * The dashboard used to start a scan the moment it saw a URL-looking ?scan=,
 * with no click and no confirmation. Any site, email or chat message could
 * therefore link a signed-in person to /dashboard?scan=https://somewhere.test
 * and spend one of their daily scans on a target they never chose, recorded
 * under their account and IP history. The request is a same-origin fetch made
 * by the app's own page, so the middleware's CSRF check never sees it.
 *
 * Now ?scan= only prefills the form. A scan starts by itself only when the
 * control that sent the person here, which they clicked on purpose ("Scan this
 * site again", the Scan button on a discovered subdomain), left a grant in
 * this tab's sessionStorage first. A page on another origin cannot write to it,
 * the grant names the one target it covers, it is spent on first use, and it
 * lapses on its own if the navigation never happened.
 */

const GRANT_KEY = "vulnradar:scan-again";

/** Long enough for a soft navigation and a cold chunk load; short enough that
 *  a grant nobody used is not still lying around when something else lands. */
const GRANT_TTL_MS = 30_000;

/** Call just before navigating to /dashboard?scan=<url> on the person's behalf. */
export function armScanAgain(url: string, now: number = Date.now()): void {
  try {
    sessionStorage.setItem(
      GRANT_KEY,
      JSON.stringify({ url, expiresAt: now + GRANT_TTL_MS }),
    );
  } catch {
    // Storage unavailable (a private window, blocked site data): the link
    // still lands on a prefilled form, which is the safe outcome anyway.
  }
}

/**
 * Whether `url` was armed moments ago in this tab. Spends the grant either
 * way: a grant that has been looked at and did not match is not left for a
 * later, different link to find.
 */
export function consumeScanAgain(
  url: string,
  now: number = Date.now(),
): boolean {
  try {
    const raw = sessionStorage.getItem(GRANT_KEY);
    if (raw === null) return false;
    sessionStorage.removeItem(GRANT_KEY);
    const grant = JSON.parse(raw) as { url?: unknown; expiresAt?: unknown };
    return (
      grant.url === url &&
      typeof grant.expiresAt === "number" &&
      grant.expiresAt > now
    );
  } catch {
    return false;
  }
}
