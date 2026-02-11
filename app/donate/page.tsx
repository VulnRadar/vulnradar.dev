"use client"

import { useEffect } from "react"

export default function DonatePage() {
  useEffect(() => {
    window.location.href = "https://buymeacoffee.com/vulnradar"
  }, [])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-muted-foreground">Redirecting to Buy Me a Coffee...</p>
      </div>
    </div>
  )
}

