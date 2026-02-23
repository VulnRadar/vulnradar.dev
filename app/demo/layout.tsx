"use client"

import React from "react"
import { PublicPageShell } from "@/components/public-page-shell"

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <PublicPageShell badge="Demo" maxWidth="max-w-5xl" padding="py-8">
      {children}
    </PublicPageShell>
  )
}
