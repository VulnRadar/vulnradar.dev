import React from "react"
import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import Script from 'next/script'
import { ThemeProvider } from '@/components/theme-provider'
import { TosGate } from '@/components/tos-gate'
import { NotificationCenter } from '@/components/notification-center'
import { APP_NAME, APP_DESCRIPTION, APP_URL, APP_VERSION, LOGO_URL } from '@/lib/constants'

import './globals.css'

const _inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const _jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' })

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} - Web Vulnerability Scanner`,
    template: '%s | ' + APP_NAME,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  keywords: ['vulnerability scanner', 'security scanner', 'web security', 'penetration testing', 'security audit', 'website scanner'],
  authors: [{ name: APP_NAME }],
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.png', type: 'image/png' },
    ],
    apple: '/favicon.png',
  },
  openGraph: {
    title: `${APP_NAME} - Web Vulnerability Scanner`,
    description: APP_DESCRIPTION,
    siteName: APP_NAME,
    type: 'website',
    url: APP_URL,
    locale: 'en_US',
    images: [
      {
        url: `${APP_URL}/og-image-120.png`,
        width: 1200,
        height: 630,
        alt: `${APP_NAME} - Web Vulnerability Scanner`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${APP_NAME} - Web Vulnerability Scanner`,
    description: APP_DESCRIPTION,
    site: '@' + APP_NAME,
    images: [`${APP_URL}/og-image-120.png`],
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    'security-contact': `${APP_URL}/.well-known/security.txt`,
    'theme-color': '#2563eb',
  },
  metadataBase: new URL(APP_URL),
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
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <TosGate>
            {children}
          </TosGate>
          <NotificationCenter />
        </ThemeProvider>
        <Script id="tawk-to" strategy="lazyOnload">
          {`var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
(function(){
var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
s1.async=true;
s1.src='https://embed.tawk.to/6993aa8073d8cb1c357e314e/1jhkd41di';
s1.charset='UTF-8';
s1.setAttribute('crossorigin','*');
s0.parentNode.insertBefore(s1,s0);
})();`}
        </Script>
      </body>
    </html>
  )
}
