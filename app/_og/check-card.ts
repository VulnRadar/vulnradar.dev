import { createHash } from "node:crypto";
import type { SeoCheck } from "@/lib/seo/checks-content";
import { OG_CARD_VERSION } from "./card";

/**
 * The social card URL for a check, versioned by what the card draws.
 *
 * next/og marks the response immutable for a year, and a check card should keep
 * that: there are hundreds of them and each render is real work. So the URL has
 * to change when the card does, or an edited title or severity keeps unfurling
 * in its old form for as long as anything has it cached. Next's own ?hash on
 * this route covers the source of opengraph-image.tsx, not the data it reads.
 *
 * JSON rather than joined strings so "ab" + "c" and "a" + "bc" stay different.
 * Not a security use of a hash; SHA-256 only because nothing here needs a
 * weaker one.
 */
export function checkOgImagePath(check: SeoCheck): string {
  const version = createHash("sha256")
    .update(
      JSON.stringify([
        check.title,
        check.description,
        check.severity,
        check.category,
        OG_CARD_VERSION,
      ]),
    )
    .digest("hex")
    .slice(0, 12);
  return `/checks/${check.id}/opengraph-image?v=${version}`;
}
