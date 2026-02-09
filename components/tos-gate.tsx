"use client"

import React from "react"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { TosModal } from "@/components/tos-modal"

const SKIP_TOS_PATHS = ["/login", "/signup", "/legal"]

export function TosGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [status, setStatus] = useState<"loading" | "accepted" | "pending" | "skip">("loading")

  const shouldSkip = SKIP_TOS_PATHS.some((p) => pathname.startsWith(p))

  useEffect(() => {
    if (shouldSkip) {
      setStatus("skip")
      return
    }

    async function check() {
      try {
        const res = await fetch("/api/auth/me")
        if (!res.ok) {
          // Not logged in - let middleware handle redirect
          setStatus("skip")
          return
        }
        const data = await res.json()
        setStatus(data.tosAcceptedAt ? "accepted" : "pending")
      } catch {
        setStatus("skip")
      }
    }

    check()
  }, [shouldSkip, pathname])

  if (status === "loading") {
    return null
  }

  if (status === "pending" && !shouldSkip) {
    return (
      <>
        <div className="pointer-events-none select-none opacity-20 blur-sm" aria-hidden>
          {children}
        </div>
        <TosModal onAccept={() => setStatus("accepted")} />
      </>
    )
  }

  return <>{children}</>
}
