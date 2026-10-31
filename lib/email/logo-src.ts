import { CONFIG_LOGO_URL } from "@/lib/config/config-values";

/**
 * A raster mark for the shell, shipped next to the SVG favicon: 52px, which is
 * the 26px the shell draws it at, doubled for dense screens.
 */
export const EMAIL_LOGO_PATH = "/email-logo.png";

/**
 * The logo URL the shell puts in its header.
 *
 * Email clients do not resolve root-relative paths, so it has to be absolute.
 * It also has to be something they draw. The default logo is /favicon.svg, and
 * Gmail and Outlook on Windows both refuse an SVG `<img>`, so the header mark
 * was missing for those readers. The default is therefore swapped for the PNG;
 * anything an operator set themselves is theirs, and is used as written.
 *
 * This is the one place that decision is made. lib/email/email.ts calls it for
 * real mail and the admin broadcast preview calls it for the iframe, which had
 * kept drawing /favicon.svg after the mail itself moved to the PNG.
 */
export function resolveEmailLogoSrc(logoUrl: string, appUrl: string): string {
  const absolute = /^https?:\/\//i.test(logoUrl)
    ? logoUrl
    : `${appUrl}${logoUrl}`;
  return absolute === `${appUrl}${CONFIG_LOGO_URL}`
    ? `${appUrl}${EMAIL_LOGO_PATH}`
    : absolute;
}
