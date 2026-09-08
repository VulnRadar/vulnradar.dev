"use client";

import { useEffect, useState } from "react";
import { ROUTES } from "@/lib/config/client-constants";

/**
 * A mailto link whose address is never in the served HTML.
 *
 * Our own replacement for Cloudflare's Email Address Obfuscation, which cannot
 * work on this site and was leaving every contact link broken. Cloudflare
 * rewrites addresses to /cdn-cgi/l/email-protection#<hex> and injects
 * cloudflare-static/email-decode.min.js to put them back; that script carries
 * no nonce, our CSP uses 'strict-dynamic', and under 'strict-dynamic' browsers
 * ignore 'self' and every host allowlist, so only nonce-carrying scripts run.
 * The decoder was blocked on every page, the address was never restored, and
 * the link led to a Cloudflare error page. Cloudflare documents no nonce or
 * integrity option, so there is nothing to allow: the only ways to run their
 * script are dropping 'strict-dynamic' or adding 'unsafe-inline', which is the
 * one line stopping an injected <script> from executing.
 *
 * Ours works because it is our script and therefore nonced. It is also a
 * simpler idea than encoding: rather than hide the address and decode it, do
 * not put it in the markup at all.
 *
 *   server render  ->  <a href="/contact">                (no address)
 *   after mount    ->  <a href="mailto:you@example.com">  (real link)
 *   no JavaScript  ->  stays /contact, which is a working contact form
 *
 * A harvester parses HTML and neither runs scripts nor hydrates, so it gets
 * the contact route and nothing to collect. That is strictly stronger than
 * obfuscation, which only defeats a naive regex and is reversible by hand.
 *
 * `reveal` is for the places the address itself is the content, such as a DMCA
 * agent contact: the label stands in until mount, then the address replaces
 * it. Everywhere else the label is fixed, so nothing shifts on hydration.
 */
export function EmailLink({
  address,
  subject,
  children,
  reveal = false,
  className,
}: {
  /** The real address. Only ever reaches an href after mount. */
  address: string;
  /** Optional prefilled subject. */
  subject?: string;
  /** Link text before (and, unless `reveal`, after) hydration. */
  children: React.ReactNode;
  /** Replace the label with the address once mounted. */
  reveal?: boolean;
  className?: string;
}) {
  // One state flip on mount. Deliberately not useSyncExternalStore or a
  // typeof-window check: those run during the server pass too, and the point
  // is that the FIRST render, the one that becomes HTML, has no address in it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot post-mount reveal, exactly as components/shared/cookie-notice.tsx does it; the point is that the render which becomes HTML has no address in it
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <a href={ROUTES.CONTACT} className={className}>
        {children}
      </a>
    );
  }

  const href = `mailto:${address}${
    subject ? `?subject=${encodeURIComponent(subject)}` : ""
  }`;

  return (
    <a href={href} className={className}>
      {reveal ? address : children}
    </a>
  );
}
