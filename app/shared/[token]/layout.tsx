import type { Metadata } from 'next'
import { APP_NAME, APP_URL } from '@/lib/constants'
import pool from '@/lib/db'

export const revalidate = 60 // ISR: revalidate every 60 seconds

type Props = {
  params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params
  
  try {
    const result = await pool.query(
      `SELECT url, summary, findings_count, scanned_at 
       FROM scan_shares 
       WHERE token = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [token]
    )

    if (!result.rows.length) {
      return {
        title: `${APP_NAME} - Shared Scan Report`,
        description: 'View a shared security scan report',
      }
    }

    const share = result.rows[0]
    const url = share.url
    const title = `Security Scan Report: ${url}`
    const description = `${share.findings_count} vulnerabilities found on ${url} • ${share.summary}`
    const ogImage = `${APP_URL}/og-scan.png`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        url: `${APP_URL}/shared/${token}`,
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
      title: `${APP_NAME} - Shared Scan Report`,
      description: 'View a shared security scan report',
    }
  }
}

export default function SharedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
