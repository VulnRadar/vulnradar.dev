"use client"

import Link from "next/link"
import Image from "next/image"
import { Heart } from "lucide-react"
import { APP_VERSION, APP_NAME, APP_URL } from "@/lib/constants"

const LEGAL_LINKS = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/disclaimer", label: "Disclaimer" },
  { href: "/legal/acceptable-use", label: "Acceptable Use" },
  { href: "/changelog", label: "Changelog" },
  { href: "/contact", label: "Contact" },

]

export function Footer() {
  return (
    <footer className="border-t border-border bg-card/50 mt-auto">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex flex-col gap-4">
          {/* Top row */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Image
                src="/favicon.svg"
                alt={`${APP_NAME} logo`}
                width={16}
                height={16}
                className="h-4 w-4"
              />
              <span className="text-sm font-semibold text-foreground">
                {APP_NAME}
              </span>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Open-source web vulnerability scanner
              </span>
              <span className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 text-[10px] font-semibold font-mono">
                v{APP_VERSION}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Link
                href="/donate"
                className="inline-flex items-center gap-1.5 text-yellow-500 hover:text-yellow-400 transition-colors"
              >
                <Heart className="h-3.5 w-3.5" />
                Support Us
              </Link>
              <span className="text-border">|</span>
              <a
                href="https://github.com/VulnRadar/vulnradar.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 fill-current"
                  aria-hidden="true"
                >
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                </svg>
                VulnRadar
              </a>
              <span className="text-border">|</span>
              <a href={APP_URL} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground">
                {APP_URL.replace(/^https?:\/\//, "")}
              </a>
            </div>
          </div>

          {/* Legal links row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 border-t border-border">
            {LEGAL_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {label}
              </Link>
            ))}
            <span className="text-xs text-muted-foreground ml-auto hidden sm:inline">
              {"\u00A9"} {new Date().getFullYear()} {APP_NAME}. For authorized security testing only.
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}
