import { ImageResponse } from "next/og"
import { APP_NAME, APP_DESCRIPTION } from "@/lib/constants"

export const runtime = "edge"
export const alt = `${APP_NAME} - Web Vulnerability Scanner`
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#000",
          backgroundImage: "radial-gradient(circle at 25% 25%, #111 0%, transparent 50%), radial-gradient(circle at 75% 75%, #0a0a0a 0%, transparent 50%)",
        }}
      >
        {/* Grid pattern overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "linear-gradient(to right, #ffffff08 1px, transparent 1px), linear-gradient(to bottom, #ffffff08 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />

        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "32px",
            padding: "48px",
          }}
        >
          {/* Logo icon */}
          <div
            style={{
              display: "flex",
              width: "80px",
              height: "80px",
              backgroundColor: "#fff",
              borderRadius: "20px",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 32 32"
              fill="none"
            >
              <rect x="4" y="4" width="10" height="10" rx="2" fill="#000" />
              <rect x="18" y="4" width="10" height="6" rx="2" fill="#000" fillOpacity="0.5" />
              <rect x="4" y="18" width="6" height="10" rx="2" fill="#000" fillOpacity="0.5" />
              <rect x="14" y="14" width="14" height="14" rx="2" fill="#000" fillOpacity="0.25" />
            </svg>
          </div>

          {/* Title */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <h1
              style={{
                fontSize: "64px",
                fontWeight: 700,
                color: "#fff",
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              {APP_NAME}
            </h1>
            <p
              style={{
                fontSize: "28px",
                color: "#888",
                margin: 0,
                maxWidth: "700px",
                textAlign: "center",
              }}
            >
              Web Vulnerability Scanner
            </p>
          </div>

          {/* Feature badges */}
          <div
            style={{
              display: "flex",
              gap: "16px",
              marginTop: "16px",
            }}
          >
            {["120+ Security Checks", "Free & Open Source", "Enterprise Ready"].map((text) => (
              <div
                key={text}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px 20px",
                  backgroundColor: "#ffffff10",
                  borderRadius: "9999px",
                  border: "1px solid #ffffff20",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: "#22c55e",
                  }}
                />
                <span style={{ color: "#fff", fontSize: "18px" }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom URL */}
        <div
          style={{
            position: "absolute",
            bottom: "32px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ color: "#666", fontSize: "20px" }}>vulnradar.dev</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
