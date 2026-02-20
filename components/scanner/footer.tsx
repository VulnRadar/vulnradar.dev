"use client"

import Link from "next/link"
import Image from "next/image"
import { Heart, Mail, Github } from "@/lib/icons"
import { APP_VERSION, APP_NAME, APP_URL, SUPPORT_EMAIL } from "@/lib/constants"
import { Button } from "@/components/ui/button"

export function Footer() {
  return (
    <footer className="border-t border-border bg-card/50 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-5 gap-8 mb-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <Image src="/favicon.svg" alt={`${APP_NAME} logo`} width={20} height={20} className="h-5 w-5" />
              <span className="text-sm font-bold text-foreground">{APP_NAME}</span>
              <span className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 text-[10px] font-semibold font-mono">
                v{APP_VERSION}
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Professional web vulnerability scanning. Open-source, free forever.
            </p>
            <Link href="/donate">
              <Button variant="outline" size="sm" className="gap-1.5 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/10 hover:text-yellow-400">
                <Heart className="h-3.5 w-3.5" />
                Support the Project
              </Button>
            </Link>
          </div>

          {/* Product */}
          <div>
            <h3 className="font-semibold text-sm mb-4 text-foreground">Product</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><Link href="/dashboard" className="hover:text-foreground transition-colors">Scanner</Link></li>
              <li><Link href="/history" className="hover:text-foreground transition-colors">History</Link></li>
              <li><Link href="/compare" className="hover:text-foreground transition-colors">Compare</Link></li>
              <li><Link href="/badge" className="hover:text-foreground transition-colors">Badges</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-semibold text-sm mb-4 text-foreground">Resources</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link></li>
              <li><Link href="/docs" className="hover:text-foreground transition-colors">Documentation</Link></li>
              <li><Link href="/docs/api" className="hover:text-foreground transition-colors">API Reference</Link></li>
              <li><Link href="/docs/setup" className="hover:text-foreground transition-colors">Setup Guide</Link></li>
              <li><Link href="/changelog" className="hover:text-foreground transition-colors">Changelog</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold text-sm mb-4 text-foreground">Legal</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><Link href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
              <li><Link href="/legal/terms" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
              <li><Link href="/legal/disclaimer" className="hover:text-foreground transition-colors">Disclaimer</Link></li>
              <li><Link href="/legal/acceptable-use" className="hover:text-foreground transition-colors">Acceptable Use</Link></li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {"\u00A9"} {new Date().getFullYear()} {APP_NAME}. For authorized security testing only.
          </p>
          <div className="flex items-center gap-4">
            <a href="https://github.com/VulnRadar/vulnradar.dev" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="GitHub">
              <Github className="h-5 w-5" />
            </a>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Email">
              <Mail className="h-5 w-5" />
            </a>
            <a href={APP_URL} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {APP_URL.replace(/^https?:\/\//, "")}
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
