"use client"

import React from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ThemeToggle } from "@/components/theme-toggle"

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-lg">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 h-14">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <Image
              src="/favicon.svg"
              alt="VulnRadar logo"
              width={20}
              height={20}
              className="h-5 w-5"
            />
            <span className="text-base font-semibold text-foreground tracking-tight">
              VulnRadar
            </span>
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {children}
      </main>

      <footer className="border-t border-border bg-card/50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
          <button onClick={() => router.push("/legal/terms")} className="hover:text-foreground transition-colors">Terms of Service</button>
          <span className="text-border">|</span>
          <button onClick={() => router.push("/legal/privacy")} className="hover:text-foreground transition-colors">Privacy Policy</button>
          <span className="text-border">|</span>
          <button onClick={() => router.push("/legal/disclaimer")} className="hover:text-foreground transition-colors">Disclaimer</button>
        </div>
      </footer>
    </div>
  )
}
