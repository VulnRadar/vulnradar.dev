import Link from "next/link"
import Image from "next/image"
import { AlertCircle, Home, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Image
            src="/favicon.svg"
            alt="VulnRadar logo"
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="text-2xl font-bold text-foreground font-mono tracking-tight">VulnRadar</span>
        </div>

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
            <Link href="/" className="flex items-center justify-center gap-2">
              <Home className="h-4 w-4" />
              Go Home
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="flex-1 bg-transparent"
          >
            <Link href="javascript:history.back()" className="flex items-center justify-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </Link>
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

