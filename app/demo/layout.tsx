'use client'

import React from 'react'
import { LandingNav } from '@/components/landing/landing-nav'
import { Footer } from '@/components/scanner/footer'

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <LandingNav />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">{children}</main>

      <Footer />
    </div>
  )
}
