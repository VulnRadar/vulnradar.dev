"use client"

import React from "react"
import { PublicPageShell } from "@/components/public-page-shell"

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PublicPageShell badge="Legal" maxWidth="max-w-4xl" padding="py-10">
      {children}
    </PublicPageShell>
  )
}
