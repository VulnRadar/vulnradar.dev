import React from "react"
import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { TosGate } from '@/components/tos-gate'

import './globals.css'

const _inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const _jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' })

export const metadata: Metadata = {
  title: 'VulnRadar - Web Vulnerability Scanner',
  description: 'Scan any website for security vulnerabilities. Get a prioritized list of issues with severity ratings and actionable fix guidance.',
  openGraph: {
    title: 'VulnRadar - Web Vulnerability Scanner',
    description: 'Scan any website for 65+ security vulnerabilities. Get severity ratings, actionable fix guidance, and exportable reports.',
    siteName: 'VulnRadar',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VulnRadar - Web Vulnerability Scanner',
    description: 'Scan any website for 65+ security vulnerabilities. Get severity ratings, actionable fix guidance, and exportable reports.',
  },
  metadataBase: new URL('https://vulnradar.app'),
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
