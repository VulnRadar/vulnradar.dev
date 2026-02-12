"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { X, Sparkles, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VERSION_COOKIE_NAME, VERSION_COOKIE_MAX_AGE, APP_VERSION, APP_NAME } from "@/lib/constants"
import { PUBLIC_PATHS } from "@/lib/public-paths"

export function VersionNotification() {
  const [show, setShow] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  // Check if current path is a public route
  const isPublicRoute = PUBLIC_PATHS.some((p) => {
    if (p === "/" || p === "/landing") {
      return pathname === p
    }
    return pathname.startsWith(p)
  })

  useEffect(() => {
    // Don't check login or show notification on public routes
    if (isPublicRoute) {
      setIsLoggedIn(false)
      return
    }

    // Check if user is logged in by checking for session
    const checkLogin = async () => {
      try {
        const response = await fetch("/api/auth/me")
        const isAuthenticated = response.ok
        setIsLoggedIn(isAuthenticated)

        if (isAuthenticated) {
          // Only show notification if user is logged in
          const cookies = document.cookie.split("; ")
          const versionCookie = cookies.find(c => c.startsWith(`${VERSION_COOKIE_NAME}=`))
          const lastSeenVersion = versionCookie?.split("=")[1]

          if (!lastSeenVersion || lastSeenVersion !== APP_VERSION) {
            setShow(true)
          }
        }
      } catch (error) {
        console.error("Failed to check login status:", error)
      }
    }

    checkLogin()
  }, [isPublicRoute])

  const handleDismiss = () => {
    // Set cookie with current version
    document.cookie = `${VERSION_COOKIE_NAME}=${APP_VERSION}; path=/; max-age=${VERSION_COOKIE_MAX_AGE}; SameSite=Lax`
    setShow(false)
  }

  const handleViewChangelog = () => {
    // Set cookie before navigating
    document.cookie = `${VERSION_COOKIE_NAME}=${APP_VERSION}; path=/; max-age=${VERSION_COOKIE_MAX_AGE}; SameSite=Lax`
    // Dismiss popup immediately
    setShow(false)
    router.push("/changelog")
  }

  if (!show || !isLoggedIn) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg mx-4">
        {/* Card */}
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
          {/* Progress bar / accent */}
          <div className="h-1 w-full bg-gradient-to-r from-primary via-emerald-500 to-primary animate-gradient" />

          {/* Close button */}
          <button
            type="button"
            onClick={handleDismiss}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Content */}
          <div className="px-8 pt-10 pb-8 flex flex-col items-center text-center">
            {/* Icon with colored background */}
            <div className="p-4 rounded-2xl bg-primary/10 text-primary mb-6">
              <Sparkles className="h-10 w-10" />
            </div>

            {/* Badge */}
            <div className="inline-flex items-center gap-2 mb-2">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                New Version
              </span>
              <span className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-semibold font-mono">
                v{APP_VERSION}
              </span>
            </div>

            {/* Title */}
            <h2 className="text-xl font-bold text-foreground mb-3 text-balance">
              {APP_NAME} Has Been Updated!
            </h2>

            {/* Description */}
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm text-pretty">
              We've added new features, improvements, and bug fixes to make your security scanning experience even better. Check out the changelog to see what's new!
            </p>
          </div>

          {/* Actions */}
          <div className="px-8 pb-8 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent"
              onClick={handleDismiss}
            >
              Dismiss
            </Button>

            <Button size="sm" className="gap-1" onClick={handleViewChangelog}>
              View Changelog
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
