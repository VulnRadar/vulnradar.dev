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
          background: 'linear-gradient(135deg, #0a0e13 0%, #0f1419 50%, #1a1f2e 100%)',
          position: 'relative',
        }}
      >
        {/* Radar circles in background */}
        <div
          style={{
            position: 'absolute',
            width: '500px',
            height: '500px',
            border: '2px solid rgba(59, 130, 246, 0.15)',
            borderRadius: '50%',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: '400px',
            height: '400px',
            border: '2px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '50%',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: '300px',
            height: '300px',
            border: '3px solid rgba(96, 165, 250, 0.3)',
            borderRadius: '50%',
            display: 'flex',
          }}
        />

        {/* Center glow */}
        <div
          style={{
            position: 'absolute',
            width: '150px',
            height: '150px',
            background: 'radial-gradient(circle, rgba(96, 165, 250, 0.4) 0%, rgba(59, 130, 246, 0.1) 50%, transparent 100%)',
            borderRadius: '50%',
            display: 'flex',
          }}
        />

        {/* Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
        >
          {/* Logo/Icon */}
          <div
            style={{
              width: '120px',
              height: '120px',
              background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
              borderRadius: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '40px',
              boxShadow: '0 20px 60px rgba(59, 130, 246, 0.6)',
            }}
          >
            <div
              style={{
                width: '80px',
                height: '80px',
                border: '4px solid white',
                borderRadius: '50%',
                position: 'relative',
                display: 'flex',
              }}
            >
              {/* Scanning beam */}
              <div
                style={{
                  position: 'absolute',
                  width: '4px',
                  height: '50px',
                  background: 'white',
                  top: '15px',
                  left: '38px',
                  transform: 'rotate(-45deg)',
                  transformOrigin: 'bottom',
                  display: 'flex',
                }}
              />
            </div>
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: '80px',
              fontWeight: 'bold',
              color: '#f8fafc',
              letterSpacing: '-2px',
              marginBottom: '20px',
              textShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
              display: 'flex',
            }}
          >
            VulnRadar
          </div>

          {/* Subtitle */}
          <div
            style={{
              fontSize: '32px',
              color: '#94a3b8',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              fontWeight: 600,
              marginBottom: '30px',
              display: 'flex',
            }}
          >
            Web Vulnerability Scanner
          </div>

          {/* Description */}
          <div
            style={{
              fontSize: '24px',
              color: '#cbd5e1',
              textAlign: 'center',
              maxWidth: '900px',
              lineHeight: 1.5,
              display: 'flex',
            }}
          >
            Scan websites for 65+ security vulnerabilities
          </div>
        </div>

        {/* Bottom accent line */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'linear-gradient(90deg, transparent 0%, #2563eb 20%, #3b82f6 50%, #60a5fa 80%, transparent 100%)',
            display: 'flex',
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  )
}

