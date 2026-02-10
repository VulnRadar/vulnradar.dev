import React from "react"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "VulnRadar",
  description: "Scan websites for 65+ security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.",
  openGraph: {
    title: "VulnRadar - Web Vulnerability Scanner",
    description: "Scan websites for 65+ security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.",
    siteName: "VulnRadar",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VulnRadar - Web Vulnerability Scanner",
    description: "Scan websites for 65+ security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.",
  },
}

export default function DisclaimerLayout({ children }: { children: React.ReactNode }) {
  return children
}

