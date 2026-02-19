"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { BookOpen, Zap } from "lucide-react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
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
      { href: "#migration", label: "Migration Tool" },
      { href: "#version", label: "Version Checking" },
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

      <Footer />
    </div>
  )
}
