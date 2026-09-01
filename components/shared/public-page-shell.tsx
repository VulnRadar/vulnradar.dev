import type { ReactNode } from "react";
import { Footer } from "@/components/scanner/footer";
import { LandingNav } from "@/components/landing/landing-nav";

/**
 * The one chrome for every page a logged-out visitor can reach.
 *
 * This used to render `isLoggedIn ? <Header/> : <LandingNav/>`, swapping in the
 * full signed-in app header on /changelog, /compare, /contact, /security,
 * /donate, /public-scans, /host/[hostname] and /shared/[token]. The other three
 * public shells (DocsShell, LegalShell, SeoPageShell) never did, so a signed-in
 * reader going Changelog -> Docs -> Changelog watched the top bar change
 * identity twice. The convention is now the simple one: a public page gets the
 * public nav, signed in or not.
 *
 * That costs a signed-in reader nothing, because LandingNav is itself
 * auth-aware: it drops "Log in" / "Start free" for a single Dashboard button,
 * which is the way back into the app.
 *
 * Dropping the swap also drops the localStorage "vr_auth_cache" pre-read this
 * file used to do in a useState initializer. It existed only to pick the right
 * nav before /auth/me resolved, and it made the client's first render disagree
 * with the server HTML for anyone with a cached session. Nothing here reads
 * auth any more, so the shell is a server component like SeoPageShell and only
 * the nav and footer islands ship to the browser.
 */
interface PublicPageShellProps {
  children: ReactNode;
  /** Label shown next to the logo, e.g. "Staff", "Shared report" */
  badge?: string;
  /** Max-width class for the main content area. Defaults to "max-w-5xl" */
  maxWidth?: string;
  /** Extra padding class for main. Defaults to "py-8" */
  padding?: string;
  /**
   * For a page built out of full-bleed sections that carry their own
   * containers (/pricing, /demo). `maxWidth` and `padding` are ignored: main
   * gets no measure and no padding of its own, matching SeoPageShell.
   */
  fullBleed?: boolean;
}

export function PublicPageShell({
  children,
  badge,
  maxWidth = "max-w-5xl",
  padding = "py-8",
  fullBleed = false,
}: PublicPageShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <LandingNav badge={badge} />

      <main
        id="main-content"
        // tabIndex={-1} is what actually makes the layout's skip link work:
        // without it the browser scrolls to <main> but leaves focus on the
        // link, so the next Tab walks back into the nav the user just skipped.
        tabIndex={-1}
        className={
          fullBleed
            ? "flex-1 min-w-0"
            : `flex-1 ${maxWidth} w-full mx-auto px-4 sm:px-6 ${padding}`
        }
      >
        {children}
      </main>

      <Footer />
    </div>
  );
}
