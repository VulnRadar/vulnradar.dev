"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/config/brand";
import { APP_NAME, ROUTES } from "@/lib/config/client-constants";

// Inline styles are deliberate here, not an oversight: this boundary replaces
// <html> and <body> themselves, so it has to render correctly even if
// globals.css failed to load or the CSS variable theme never initialised. The
// one <style> element below is part of this document for the same reason,
// which is also the only way to get a prefers-color-scheme block without CSS
// variables from globals.css.
//
// This file is the literal-hex mirror of app/not-found.tsx and app/error.tsx:
// same wordmark lockup, same ruled band with a monospace status numeral, same
// digest block, same two-up action row, same footer links. If you change the
// composition in either of those, change it here too. It used to be a wholly
// different design (a 6rem icon circle, no wordmark, no numeral, no digest,
// dark only) painted in the Tailwind zinc ramp with links in a teal the
// product no longer has, so the page a user reaches when the app has failed
// hardest was the one that looked least like the product.
const PALETTE = {
  // Transcribed from lib/config/brand.ts, which this file also imports for
  // the values that have a direct BRAND key. The light ramp has no BRAND
  // equivalent (BRAND mirrors the dark theme only), so it is spelled out.
  darkBg: BRAND.bg,
  darkSurface: BRAND.surface,
  darkBorder: BRAND.border,
  darkText: BRAND.text,
  darkMuted: BRAND.textMuted,
  lightBg: "#eff2f5",
  lightSurface: "#ffffff",
  lightBorder: "#dfe5ec",
  lightText: "#14181f",
  lightMuted: "#55617a",
  link: BRAND.primaryLight,
};

const CSS = `
:root{color-scheme:dark light}
.vr-ge{
  --ge-bg:${PALETTE.darkBg};
  --ge-surface:${PALETTE.darkSurface};
  --ge-border:${PALETTE.darkBorder};
  --ge-text:${PALETTE.darkText};
  --ge-muted:${PALETTE.darkMuted};
  --ge-rule:rgba(255,255,255,0.08);
}
@media (prefers-color-scheme: light){
  .vr-ge{
    --ge-bg:${PALETTE.lightBg};
    --ge-surface:${PALETTE.lightSurface};
    --ge-border:${PALETTE.lightBorder};
    --ge-text:${PALETTE.lightText};
    --ge-muted:${PALETTE.lightMuted};
    --ge-rule:rgba(0,0,0,0.10);
  }
}
.vr-ge{
  margin:0;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:1rem;
  background:var(--ge-bg,${PALETTE.darkBg});
  color:var(--ge-text,${PALETTE.darkText});
  font-family:system-ui,-apple-system,sans-serif;
}
.vr-ge-inner{width:100%;max-width:28rem;display:flex;flex-direction:column;align-items:center;gap:2rem}
.vr-ge-mark{display:flex;align-items:center;gap:0.625rem}
.vr-ge-wordmark{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.25rem;font-weight:600;letter-spacing:-0.01em}
.vr-ge-band{
  width:100%;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:0.75rem;
  text-align:center;
  padding:2rem 0;
  border-top:1px solid var(--ge-rule,rgba(255,255,255,0.08));
  border-bottom:1px solid var(--ge-rule,rgba(255,255,255,0.08));
}
.vr-ge-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:3.75rem;font-weight:600;font-variant-numeric:tabular-nums;line-height:1;margin:0}
.vr-ge-title{font-size:1.125rem;font-weight:600;margin:0}
.vr-ge-body{font-size:0.875rem;color:var(--ge-muted,${PALETTE.darkMuted});line-height:1.6;margin:0;max-width:24rem}
.vr-ge-digest{width:100%;margin-top:0.5rem;border:1px solid var(--ge-border,${PALETTE.darkBorder});border-radius:0.5rem;background:var(--ge-surface,${PALETTE.darkSurface});overflow:hidden;text-align:left}
.vr-ge-digest-head{display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.75rem;border-bottom:1px solid var(--ge-border,${PALETTE.darkBorder})}
.vr-ge-digest-label{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.75rem;color:var(--ge-muted,${PALETTE.darkMuted})}
.vr-ge-digest-value{margin:0;padding:0.625rem 0.75rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.75rem;word-break:break-all}
.vr-ge-actions{display:flex;gap:0.75rem;width:100%}
.vr-ge-btn{flex:1;padding:0.625rem 1rem;border-radius:0.5rem;font-size:0.875rem;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.5rem;text-decoration:none;font-family:inherit}
.vr-ge-btn-primary{border:none;background:${BRAND.primary};color:${BRAND.onPrimary}}
.vr-ge-btn-secondary{border:1px solid var(--ge-border,${PALETTE.darkBorder});background:transparent;color:var(--ge-text,${PALETTE.darkText})}
.vr-ge-copy{border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:0.75rem;color:var(--ge-muted,${PALETTE.darkMuted})}
.vr-ge-links{display:flex;gap:1rem;font-size:0.75rem;align-items:center}
.vr-ge-links a{color:${PALETTE.link};text-decoration:none}
.vr-ge-links span{color:var(--ge-muted,${PALETTE.darkMuted})}
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error(`[${APP_NAME}] Fatal error:`, error);
  }, [error]);

  async function copyDigest() {
    // navigator.clipboard is absent on http origins and in older browsers,
    // and throws when the document is not focused. A failed copy just leaves
    // the id on screen to select by hand.
    if (!error.digest) return;
    try {
      await navigator.clipboard?.writeText(error.digest);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the id is already rendered, nothing else to do */
    }
  }

  return (
    <html lang="en">
      <body className="vr-ge">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="vr-ge-inner">
          <div className="vr-ge-mark">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <g
                fill="none"
                stroke={BRAND.primaryLight}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
                <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
                <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" />
                <circle
                  cx="12"
                  cy="12"
                  r="2"
                  fill={BRAND.primaryLight}
                  stroke="none"
                />
              </g>
            </svg>
            <span className="vr-ge-wordmark">{APP_NAME}</span>
          </div>

          <div className="vr-ge-band">
            <p className="vr-ge-code">500</p>
            <h1 className="vr-ge-title">Something broke on our end</h1>
            <p className="vr-ge-body">
              {error.digest
                ? "This has been logged. Reloading usually fixes it, and quoting the id below tells us exactly which failure was yours."
                : "The app could not recover on its own. Reloading usually fixes it; if it keeps happening, tell us what you were doing."}
            </p>

            {error.digest && (
              <div className="vr-ge-digest">
                <div className="vr-ge-digest-head">
                  <span className="vr-ge-digest-label">error.digest</span>
                  <button
                    type="button"
                    onClick={copyDigest}
                    className="vr-ge-copy"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="vr-ge-digest-value">{error.digest}</p>
              </div>
            )}
          </div>

          <div className="vr-ge-actions">
            <button
              type="button"
              onClick={reset}
              className="vr-ge-btn vr-ge-btn-primary"
            >
              Try again
            </button>
            {/* ROUTES.HOME, not the dashboard: this boundary is reachable from
                any route, including the public marketing and check pages, and
                a signed-out visitor sent to the dashboard just bounces to the
                login screen. Same reasoning as app/not-found.tsx. */}
            <a href={ROUTES.HOME} className="vr-ge-btn vr-ge-btn-secondary">
              Go to the home page
            </a>
          </div>

          <div className="vr-ge-links">
            <a href={ROUTES.CONTACT}>Contact</a>
            <span aria-hidden="true">&middot;</span>
            <a href={ROUTES.DOCS}>Documentation</a>
          </div>
        </div>
      </body>
    </html>
  );
}
