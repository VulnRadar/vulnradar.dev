"use client"

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[VulnRadar] Fatal error:", error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: "#09090b", color: "#fafafa", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ maxWidth: "28rem", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "2rem", textAlign: "center" }}>
            {/* Icon */}
            <div style={{ width: "6rem", height: "6rem", borderRadius: "50%", backgroundColor: "rgba(239,68,68,0.1)", border: "2px solid rgba(239,68,68,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <h1 style={{ fontSize: "3.75rem", fontWeight: 700, fontFamily: "monospace", margin: 0, lineHeight: 1 }}>500</h1>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Critical Error</h2>
              <p style={{ fontSize: "0.875rem", color: "#a1a1aa", lineHeight: 1.6, margin: 0 }}>
                Something went seriously wrong. The application could not recover from this error. Please try refreshing the page.
              </p>
            </div>

            {error.digest && (
              <p style={{ fontSize: "0.75rem", color: "#71717a", fontFamily: "monospace", backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "0.5rem", padding: "0.375rem 0.75rem", margin: 0 }}>
                Error ID: {error.digest}
              </p>
            )}

            <div style={{ display: "flex", gap: "0.75rem", width: "100%" }}>
              <button
                onClick={reset}
                style={{
                  flex: 1, padding: "0.625rem 1rem", borderRadius: "0.5rem", border: "none",
                  backgroundColor: "#3b82f6", color: "#fff", fontSize: "0.875rem", fontWeight: 500,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                }}
              >
                Try Again
              </button>
              <a
                href="/"
                style={{
                  flex: 1, padding: "0.625rem 1rem", borderRadius: "0.5rem",
                  border: "1px solid rgba(255,255,255,0.1)", backgroundColor: "transparent",
                  color: "#fafafa", fontSize: "0.875rem", fontWeight: 500, textDecoration: "none",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                }}
              >
                Go Home
              </a>
            </div>

            <div style={{ display: "flex", gap: "1rem", fontSize: "0.75rem", paddingTop: "1rem" }}>
              <a href="/contact" style={{ color: "#3b82f6", textDecoration: "none" }}>Contact Support</a>
              <span style={{ color: "#52525b" }}>·</span>
              <a href="/docs" style={{ color: "#3b82f6", textDecoration: "none" }}>Documentation</a>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
