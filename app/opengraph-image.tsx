import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'VulnRadar - Web Vulnerability Scanner'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0b0f14', // Matching the dark theme bg
          backgroundImage: 'radial-gradient(circle at 25px 25px, #1f2937 2%, transparent 0%), radial-gradient(circle at 75px 75px, #1f2937 2%, transparent 0%)',
          backgroundSize: '100px 100px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 40,
          }}
        >
          {/* Logo SVG scaled up */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="256"
            height="256"
            viewBox="0 0 24 24"
            style={{ marginRight: 0 }}
          >
            <circle cx="12" cy="12" r="11" fill="#0f172a" />

            <path d="M12 2a10 10 0 1 1-7.07 17.07l1.41-1.41A8 8 0 1 0 12 4V2z" fill="#3b82f6" opacity="0.2" />

            <path d="M12 6a6 6 0 1 1-4.24 10.24l1.41-1.41A4 4 0 1 0 12 8V6z" fill="#3b82f6" opacity="0.4" />

            {/* Group for strokes */}
            <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            <path d="m13.41 10.59 5.66-5.66" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />

            <circle cx="12" cy="12" r="2" fill="#60a5fa" stroke="none" />

            <circle cx="4" cy="6" r="1" fill="#fbbf24" stroke="none" />
            <circle cx="12" cy="18" r="1" fill="#fbbf24" stroke="none" />
          </svg>
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 130,
            fontFamily: 'Courier New', // Using a mono font if available or fallback
            fontWeight: 700,
            color: '#f8fafc',
            letterSpacing: '-2px',
            lineHeight: 1,
            textShadow: '0 10px 30px rgba(0,0,0,0.5)',
          }}
        >
          VulnRadar
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
