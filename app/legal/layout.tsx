"use client"

import React from "react"
import { LandingNav } from "@/components/landing/landing-nav"
import { Footer } from "@/components/scanner/footer"
import { LegalNav } from "@/components/legal"

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <LandingNav />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8">
        <LegalNav />
        {children}
      </main>
      <Footer />
    </div>
  )
}
