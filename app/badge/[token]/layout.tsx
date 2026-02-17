import type { Metadata } from 'next'
import { APP_NAME, APP_URL } from '@/lib/constants'
import pool from '@/lib/db'

export const revalidate = 300 // ISR: revalidate every 5 minutes

type Props = {
  params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params
  
  try {
    const result = await pool.query(
      `SELECT sb.domain, sb.latest_score
       FROM scan_badges sb
       WHERE sb.token = $1`,
      [token]
    )

    if (!result.rows.length) {
      return {
        title: `${APP_NAME} - Security Badge`,
        description: 'VulnRadar security badge',
      }
    }

    const badge = result.rows[0]
    const domain = badge.domain
    const score = badge.latest_score
    const title = `${domain} Security Score: ${score}/100`
    const description = `View the security scan results for ${domain} on ${APP_NAME}`
    const ogImage = `${APP_URL}/og-badge.png`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        url: `${APP_URL}/badge/${token}`,
        siteName: APP_NAME,
        images: [
          {
            url: ogImage,
            width: 1200,
            height: 630,
            alt: title,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImage],
      },
    }
  } catch {
    return {
      title: `${APP_NAME} - Security Badge`,
      description: 'VulnRadar security badge',
    }
  }
}

export default function BadgeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
