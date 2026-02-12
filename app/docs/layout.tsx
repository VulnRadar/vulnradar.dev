"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { BookOpen, Zap, Github, Mail } from "lucide-react"
import { Header } from "@/components/scanner/header"
import { APP_NAME } from "@/lib/constants"
import { useState } from "react"

const navItems = [
  { href: "/docs", label: "Getting Started", icon: BookOpen },
  { 
    href: "/docs/api", 
    label: "API Reference", 
    icon: Zap,
    hasDropdown: true,
    dropdownItems: [
      { href: "#authentication", label: "Authentication" },
      { href: "#endpoints", label: "Endpoints" },
      { href: "#request-response", label: "Request & Response" },
      { href: "#examples", label: "Code Examples" },
      { href: "#errors", label: "Error Handling" },
      { href: "#ratelimit", label: "Rate Limiting" },
      { href: "#webhooks", label: "Webhooks" },
      { href: "#best-practices", label: "Best Practices" },
    ]
  },
  { 
    href: "/docs/setup", 
    label: "Setup Guide", 
    icon: BookOpen,
    hasDropdown: true,
    dropdownItems: [
      { href: "#prerequisites", label: "Prerequisites" },
      { href: "#installation", label: "Installation" },
      { href: "#database", label: "Database Setup" },
      { href: "#environment", label: "Environment Configuration" },
      { href: "#running", label: "Running the Application" },
      { href: "#verification", label: "Verification Steps" },
      { href: "#troubleshooting", label: "Troubleshooting" },
      { href: "#deployment", label: "Deployment Options" },
    ]
  },
]

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  
  // Auto-open dropdown for API and Setup pages on desktop
  const isApiPage = pathname.startsWith("/docs/api")
  const isSetupPage = pathname.startsWith("/docs/setup")
  const shouldShowDropdown = isApiPage ? "/docs/api" : isSetupPage ? "/docs/setup" : null

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <aside className="lg:w-48 flex-shrink-0">
            <nav className="space-y-1 sticky top-24">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || (item.href === "/docs/api" && pathname.startsWith("/docs/api")) || (item.href === "/docs/setup" && pathname.startsWith("/docs/setup"))
                // Auto-open dropdown on desktop for API and Setup pages, can't close
                const isAutoOpenedDropdown = shouldShowDropdown === item.href
                const isDropdownOpen = isAutoOpenedDropdown ? true : openDropdown === item.href
                
                return (
                  <div key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-muted"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                    
                    {/* Dropdown - Only show on lg screens if on that page */}
                    {item.hasDropdown && isAutoOpenedDropdown && item.dropdownItems && (
                      <div className="space-y-1 mt-1 ml-4 hidden lg:block">
                        {item.dropdownItems.map((dropItem) => (
                          <a
                            key={dropItem.href}
                            href={dropItem.href}
                            className="flex items-center gap-3 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            {dropItem.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </nav>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="font-semibold mb-4">{APP_NAME}</h3>
              <p className="text-sm text-muted-foreground">Professional web vulnerability scanning. Completely free, forever.</p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Product</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/dashboard" className="hover:text-foreground transition-colors">Scanner</Link></li>
                <li><Link href="/history" className="hover:text-foreground transition-colors">History</Link></li>
                <li><Link href="/compare" className="hover:text-foreground transition-colors">Compare</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Resources</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/docs" className="hover:text-foreground transition-colors">Documentation</Link></li>
                <li><Link href="/docs/api" className="hover:text-foreground transition-colors">API Reference</Link></li>
                <li><Link href="/docs/setup" className="hover:text-foreground transition-colors">Setup Guide</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Legal</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy</Link></li>
                <li><Link href="/legal/terms" className="hover:text-foreground transition-colors">Terms</Link></li>
                <li><Link href="/contact" className="hover:text-foreground transition-colors">Support</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="GitHub">
                <Github className="h-5 w-5" />
              </a>
              <a href="mailto:support@vulnradar.com" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Email">
                <Mail className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
