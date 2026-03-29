"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { AlertCircle, Home, ArrowLeft } from "lucide-react"
import { ThemedLogo } from "@/components/shared/themed-logo"
import { Button } from "@/components/ui/button"
import { APP_NAME } from "@/lib/config/constants"
import { transitions } from "@/lib/ui/animations"

export default function NotFound() {
  const router = useRouter()
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Background glow orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
      
      <div className="w-full max-w-md flex flex-col items-center gap-8 relative z-10 animate-fade-in">
        {/* Logo */}
        <Link href="/" className={`flex items-center gap-2.5 group ${transitions.default}`}>
          <ThemedLogo width={32} height={32} className="h-8 w-8 transition-transform group-hover:scale-105" alt={`${APP_NAME} logo`} />
          <span className="text-2xl font-bold text-foreground tracking-tight">{APP_NAME}</span>
        </Link>

        {/* 404 Icon and Message */}
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
            <div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-primary/10 border-2 border-primary/20">
              <AlertCircle className="h-12 w-12 text-primary" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h1 className="text-6xl font-bold text-foreground font-mono">404</h1>
            <h2 className="text-xl font-semibold text-foreground">Page Not Found</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
              The page you're looking for doesn't exist or has been moved.
              Let's get you back on track.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <Button
            asChild
            variant="default"
            className="flex-1"
          >
            <Link href="/dashboard" className="flex items-center justify-center gap-2">
              <Home className="h-4 w-4" />
              Go to Dashboard
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="flex-1 bg-transparent"
          >
            <button onClick={() => router.back()} className="flex items-center justify-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </button>
          </Button>
        </div>

        {/* Helper Links */}
        <div className="flex flex-col items-center gap-2 pt-4">
          <p className="text-xs text-muted-foreground">Need help?</p>
          <div className="flex gap-4 text-xs">
            <Link href="/contact" className="text-primary hover:underline">
              Contact Support
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link href="/docs" className="text-primary hover:underline">
              Documentation
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link href="/changelog" className="text-primary hover:underline">
              Changelog
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
