import React from "react"
import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { TosGate } from '@/components/tos-gate'

import './globals.css'

const _inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const _jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' })

export const metadata: Metadata = {
  title: {
    default: 'VulnRadar - Web Vulnerability Scanner',
    template: '%s | VulnRadar'
  },
  description: 'Scan websites for 65+ security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.',
  applicationName: 'VulnRadar',
  keywords: ['vulnerability scanner', 'security scanner', 'web security', 'penetration testing', 'security audit', 'website scanner'],
  authors: [{ name: 'VulnRadar' }],
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.png', type: 'image/png' },
    ],
    apple: '/favicon.png',
  },
  openGraph: {
    title: 'VulnRadar - Web Vulnerability Scanner',
    description: 'Scan websites for 65+ security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.',
    siteName: 'VulnRadar',
    type: 'website',
    url: 'https://vulnradar.dev',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VulnRadar - Web Vulnerability Scanner',
    description: 'Scan websites for 65+ security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.',
    site: '@VulnRadar',
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    'security-contact': 'https://vulnradar.dev/.well-known/security.txt',
    'theme-color': '#2563eb',
  },
  metadataBase: new URL('https://vulnradar.dev'),
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f7fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1117' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="security" type="text/plain" href="/.well-known/security.txt" />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <TosGate>
            {children}
          </TosGate>
        </ThemeProvider>
      </body>
    </html>
  )
}
