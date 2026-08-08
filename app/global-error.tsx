"use client";

import { useEffect } from "react";
import { APP_NAME, ROUTES } from "@/lib/config/constants";

// Inline styles are deliberate here, not an oversight: this boundary replaces
// <html> and <body> themselves, so it has to render correctly even if
// globals.css failed to load or the CSS variable theme never initialised.
// It cannot depend on Tailwind utilities resolving `hsl(var(--primary))`.
const BRAND_TEAL = "#0891b2";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(`[${APP_NAME}] Fatal error:`, error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          backgroundColor: "#09090b",
          color: "#fafafa",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            style={{
              maxWidth: "28rem",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "2rem",
              textAlign: "center",
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: "6rem",
                height: "6rem",
                borderRadius: "50%",
                backgroundColor: "rgba(239,68,68,0.1)",
                border: "2px solid rgba(239,68,68,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              <h1
                style={{
                  fontSize: "3.75rem",
                  fontWeight: 700,
                  fontFamily: "monospace",
                  margin: 0,
                  lineHeight: 1,
                }}
              >
                500
              </h1>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
                {APP_NAME} hit a critical error
              </h2>
              <p
                style={{
                  fontSize: "0.875rem",
                  color: "#a1a1aa",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                The app could not recover on its own. Reloading usually fixes
                it; if it keeps happening, tell us what you were doing.
              </p>
            </div>

            {error.digest && (
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "#71717a",
                  fontFamily: "monospace",
                  backgroundColor: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "0.5rem",
                  padding: "0.375rem 0.75rem",
                  margin: 0,
                }}
              >
                Error ID: {error.digest}
              </p>
            )}

            <div style={{ display: "flex", gap: "0.75rem", width: "100%" }}>
              <button
                onClick={reset}
                style={{
                  flex: 1,
                  padding: "0.625rem 1rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  backgroundColor: BRAND_TEAL,
                  color: "#fff",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                }}
              >
                Try again
              </button>
              <a
                href={ROUTES.DASHBOARD}
                style={{
                  flex: 1,
                  padding: "0.625rem 1rem",
                  borderRadius: "0.5rem",
                  border: "1px solid rgba(255,255,255,0.1)",
                  backgroundColor: "transparent",
                  color: "#fafafa",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  textDecoration: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                }}
              >
                Go to Dashboard
              </a>
            </div>

            <div
              style={{
                display: "flex",
                gap: "1rem",
                fontSize: "0.75rem",
                paddingTop: "1rem",
              }}
            >
              <a
                href={ROUTES.CONTACT}
                style={{ color: BRAND_TEAL, textDecoration: "none" }}
              >
                Contact support
              </a>
              <span style={{ color: "#52525b" }}>·</span>
              <a
                href={ROUTES.DOCS}
                style={{ color: BRAND_TEAL, textDecoration: "none" }}
              >
                Documentation
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
