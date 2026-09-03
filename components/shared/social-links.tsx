// SOCIAL ACCOUNT LINKS
//
// The only place that knows which brand mark goes with which platform. The
// URLs themselves come from SOCIAL_LINKS (lib/config/client-constants.ts),
// which has already dropped every platform this deployment has not
// configured, so there is no "are there any?" branch to get wrong here: a
// deployment with no accounts renders nothing because the list is empty.
//
// No `"use client"` on purpose. The footer is a client component and the
// landing page's open-source section is a server component, and both render
// this; without a directive it compiles into whichever graph imports it
// instead of forcing a client boundary onto the landing page for a handful of
// static anchors.
//
// Every mark comes from react-icons, which is already a dependency (the
// GitHub mark in this same footer is FaGithub). Nothing is loaded from the
// platforms themselves: these are plain anchors, not embeds, so no
// third-party script, pixel, or frame is introduced and the CSP is untouched.

import type { IconType } from "react-icons";
import {
  FaBluesky,
  FaDiscord,
  FaInstagram,
  FaLinkedinIn,
  FaMastodon,
  FaRedditAlien,
  FaRss,
  FaTiktok,
  FaXTwitter,
  FaYoutube,
} from "react-icons/fa6";

import {
  SOCIAL_LINKS,
  type SocialPlatformId,
} from "@/lib/config/client-constants";

/** Exhaustive over SocialPlatformId, so adding an id to the registry without
 *  choosing a mark for it fails typecheck here rather than rendering blank. */
const MARKS: Record<SocialPlatformId, IconType> = {
  youtube: FaYoutube,
  tiktok: FaTiktok,
  instagram: FaInstagram,
  x: FaXTwitter,
  discord: FaDiscord,
  mastodon: FaMastodon,
  bluesky: FaBluesky,
  linkedin: FaLinkedinIn,
  reddit: FaRedditAlien,
  rss: FaRss,
};

interface SocialLinksProps {
  /** Applied to each anchor. The caller owns the shape and the touch target,
   *  since the footer's row and the landing page's row size differently. */
  className: string;
  /** Applied to each mark. */
  iconClassName?: string;
}

/**
 * A fragment of one anchor per configured platform, so the caller can drop it
 * straight into its own flex row next to whatever else lives there.
 *
 * `rel="noopener noreferrer"` on all of them: noopener because these open in
 * a new tab, noreferrer because which page a visitor came from is nobody
 * else's business.
 */
export function SocialLinks({ className, iconClassName }: SocialLinksProps) {
  return (
    <>
      {SOCIAL_LINKS.map(({ id, label, url }) => {
        const Mark = MARKS[id];
        return (
          <a
            key={id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            // The link has no text, so without this it announces as its own
            // URL. `title` gives sighted users the same name on hover.
            aria-label={label}
            title={label}
            className={className}
          >
            <Mark className={iconClassName} aria-hidden="true" />
          </a>
        );
      })}
    </>
  );
}
