"use client"

import React from "react"
import { PublicPageShell } from "@/components/public-page-shell"

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <PublicPageShell badge="Staff" maxWidth="max-w-4xl" padding="py-10">
      {children}
    </PublicPageShell>
  )
}
