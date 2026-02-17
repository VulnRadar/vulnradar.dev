import { APP_NAME, APP_DESCRIPTION, APP_URL } from '@/lib/constants'

export default function Head() {
  const title = `${APP_NAME} - Web Vulnerability Scanner`
  const image = `${APP_URL}/og-image-120-revise.png`

  return (
    <>
      <link rel="security" type="text/plain" href="/.well-known/security.txt" />

      {/* Basic metadata */}
      <title>{title}</title>
      <meta name="description" content={APP_DESCRIPTION} />
      <meta name="application-name" content={APP_NAME} />
      <meta name="keywords" content="vulnerability scanner,security scanner,web security,penetration testing,security audit,website scanner" />

      {/* Open Graph */}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={APP_DESCRIPTION} />
      <meta property="og:site_name" content={APP_NAME} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={APP_URL} />
      <meta property="og:locale" content="en_US" />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={`${APP_NAME} - Web Vulnerability Scanner`} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={`@${APP_NAME}`} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={APP_DESCRIPTION} />
      <meta name="twitter:image" content={image} />

      {/* Icons */}
      <link rel="icon" href="/favicon.ico" />
      <link rel="icon" href="/favicon.png" type="image/png" />
      <link rel="apple-touch-icon" href="/favicon.png" />
    </>
  )
}
