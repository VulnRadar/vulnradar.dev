/**
 * Whether a person-chosen name is fit to print in mail to an address nobody
 * has verified.
 *
 * Signup, the contact form and team invites all take a name from whoever
 * typed it and put it into a message we send from our own domain to an
 * address they also typed. "Claim your payout at example.tld/x" is a valid
 * name by every length check we have, and it arrives in a stranger's inbox as
 * "Hi Claim your payout at example.tld/x", with our domain's reputation behind
 * it. Spam filters score the link, and a recipient who reports it reports us.
 *
 * So a name that carries a link, an address or a long run of digits is not
 * printed at all. Callers fall back to wording that needs no name, and the
 * name is still stored and shown everywhere the account owner reads it. Pure,
 * and free of server imports, so it can be tested and reused anywhere.
 */

/**
 * Longest name worth printing. Validation already caps names at 255, and the
 * domain-shaped pattern below is only quick on input of that size.
 */
const NAME_MAX_CHARS = 255;

/** A scheme, "www.", or the "://" every link has. */
const LINK_MARKER = /https?:|ftp:|www\.|:\/\//i;

/**
 * Something shaped like a hostname: a label, a dot, then letters. "bit.ly",
 * "claim-prize.top" and "pay.me" are all caught. So is "Dr.Smith", which is
 * the price of not shipping a TLD list; that name falls back to a greeting
 * with no name in it, which costs nothing.
 */
const HOSTNAME_SHAPE = /\b[a-z0-9-]{2,}\.[a-z]{2,}\b/i;

/** Control characters, which have no business in a name or a subject line. */
// oxlint-disable-next-line no-control-regex -- finding them is the point
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export function isSafeDisplayName(name: string | null | undefined): boolean {
  if (typeof name !== "string") return false;
  const value = name.trim();
  if (value.length === 0 || value.length > NAME_MAX_CHARS) return false;
  if (value.includes("@")) return false;
  if (CONTROL_CHARS.test(value)) return false;
  if (LINK_MARKER.test(value) || HOSTNAME_SHAPE.test(value)) return false;
  // A phone number or an account id: five digits in a row, or seven digits
  // spread across the name however they are separated.
  if (/\d{5,}/.test(value)) return false;
  if ((value.match(/\d/g) ?? []).length >= 7) return false;
  return true;
}

/** The trimmed name when it is safe to print, otherwise `fallback`. */
export function safeDisplayName(
  name: string | null | undefined,
  fallback = "",
): string {
  return isSafeDisplayName(name) ? (name as string).trim() : fallback;
}
