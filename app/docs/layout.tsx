"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { BookOpen, Zap, Code2, ChevronRight } from "lucide-react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { APP_NAME, ROUTES, BILLING_ENABLED } from "@/lib/constants"
import { useState, useEffect, createContext, useContext } from "react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-provider"
import { ThemedLogo } from "@/components/themed-logo"

// Context for sharing active section state between layout and pages
interface DocsContextType {
  activeSection: string
  setActiveSection: (section: string) => void
  tocItems: TocItem[]
  setTocItems: (items: TocItem[]) => void
}

export interface TocItem {
  id: string
  label: string
  level?: number
}

const DocsContext = createContext<DocsContextType>({
  activeSection: "",
  setActiveSection: () => {},
  tocItems: [],
  setTocItems: () => {},
})

export function useDocsContext() {
  return useContext(DocsContext)
}

const mainNavItems = [
  { href: "/docs", label: "Getting Started", icon: BookOpen, exact: true },
  { href: "/docs/api", label: "API Reference", icon: Zap },
  { href: "/docs/setup", label: "Setup Guide", icon: BookOpen },
  { href: "/docs/developers", label: "Developers", icon: Code2 },
]

function getInitialAuthState(): boolean | null {
  if (typeof window === "undefined") return null
  try {
    const cached = localStorage.getItem("vr_auth_cache")
    if (cached) return !!JSON.parse(cached)?.userId
  } catch {}
  return null
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { me, isLoading } = useAuth()
  const [activeSection, setActiveSection] = useState("")
  const [tocItems, setTocItems] = useState<TocItem[]>([])
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [cachedAuth, setCachedAuth] = useState<boolean | null>(() => getInitialAuthState())

  useEffect(() => {
    if (!isLoading) setCachedAuth(!!me?.userId)
  }, [me, isLoading])

  // Close mobile nav on route change
  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  const isLoggedIn = cachedAuth === true || !!me?.userId

  return (
    <DocsContext.Provider value={{ activeSection, setActiveSection, tocItems, setTocItems }}>
      <div className="min-h-screen flex flex-col bg-background">
        {isLoggedIn ? (
          <Header />
        ) : (
          <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 relative flex items-center">
              <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity z-10">
                <ThemedLogo width={24} height={24} className="h-6 w-6" alt={`${APP_NAME} logo`} />
                <span className="font-semibold text-lg tracking-tight">{APP_NAME}</span>
              </Link>
              <nav className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2">
                {BILLING_ENABLED && (
                  <Link href={ROUTES.PRICING} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
                )}
                <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Docs</Link>
                <Link href="/demo" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Demo</Link>
              </nav>
              <div className="flex items-center gap-3 ml-auto z-10">
                <Link href={ROUTES.LOGIN}><Button variant="ghost" size="sm">Log in</Button></Link>
                <Link href={ROUTES.SIGNUP} className="hidden sm:block"><Button size="sm">Get Started</Button></Link>
              </div>
            </div>
          </header>
        )}
        
        <div className="flex-1 max-w-[90rem] w-full mx-auto">
          <div className="flex">
            {/* Left Sidebar - Main Navigation */}
            <aside className="hidden lg:block w-64 flex-shrink-0 border-r border-border/40">
              <nav className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-8 px-6">
                <div className="mb-6">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Documentation
                  </h2>
                </div>
                <ul className="space-y-1">
                  {mainNavItems.map((item) => {
                    const Icon = item.icon
                    const isActive = item.exact 
                      ? pathname === item.href 
                      : pathname.startsWith(item.href) && (item.href !== "/docs" || pathname === "/docs")
                    
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            "group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                            isActive
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          )}
                        >
                          <Icon className={cn(
                            "h-4 w-4 transition-transform duration-200",
                            !isActive && "group-hover:scale-110"
                          )} />
                          <span>{item.label}</span>
                          {isActive && (
                            <ChevronRight className="h-3 w-3 ml-auto opacity-70" />
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>

                {/* Version Badge */}
                <div className="mt-8 pt-6 border-t border-border/40">
                  <div className="px-3 py-2 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">API Version:</span> v2
                    <br />
                    <span className="text-[10px]">v1 deprecated</span>
                  </div>
                </div>
              </nav>
            </aside>

            {/* Mobile Navigation Toggle */}
            <div className="lg:hidden fixed bottom-20 right-4 z-50">
              <button
                onClick={() => setMobileNavOpen(!mobileNavOpen)}
                className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-full shadow-lg text-xs sm:text-sm font-medium"
              >
                <BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">Docs</span>
              </button>
            </div>

            {/* Mobile Navigation Overlay */}
            {mobileNavOpen && (
              <div className="lg:hidden fixed inset-0 z-40 bg-background/95 backdrop-blur-sm">
                <div className="p-6 pt-20">
                  <button
                    onClick={() => setMobileNavOpen(false)}
                    className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground"
                  >
                    <span className="sr-only">Close</span>
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <nav className="space-y-2">
                    {mainNavItems.map((item) => {
                      const Icon = item.icon
                      const isActive = item.exact 
                        ? pathname === item.href 
                        : pathname.startsWith(item.href) && (item.href !== "/docs" || pathname === "/docs")
                      
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMobileNavOpen(false)}
                          className={cn(
                            "flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "text-foreground hover:bg-muted"
                          )}
                        >
                          <Icon className="h-5 w-5" />
                          <span>{item.label}</span>
                        </Link>
                      )
                    })}
                  </nav>

                  {/* Mobile ToC */}
                  {tocItems.length > 0 && (
                    <div className="mt-8 pt-6 border-t border-border">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                        On This Page
                      </h3>
                      <nav className="space-y-1">
                        {tocItems.map((item) => (
                          <a
                            key={item.id}
                            href={`#${item.id}`}
                            onClick={() => setMobileNavOpen(false)}
                            className={cn(
                              "block px-3 py-2 rounded-md text-sm transition-colors",
                              item.level === 2 && "pl-6",
                              activeSection === item.id
                                ? "text-primary font-medium bg-primary/5"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                            )}
                          >
                            {item.label}
                          </a>
                        ))}
                      </nav>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Main Content */}
            <main className="flex-1 min-w-0 px-3 sm:px-6 lg:px-10 py-6 sm:py-8 lg:py-10">
              <article className="max-w-4xl mx-auto lg:mx-0">
                {children}
              </article>
            </main>

            {/* Right Sidebar - Table of Contents */}
            {tocItems.length > 0 && (
              <aside className="hidden xl:block w-64 flex-shrink-0">
                <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-8 px-6">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                    On This Page
                  </h3>
                  <nav className="space-y-1">
                    {tocItems.map((item) => (
                      <a
                        key={item.id}
                        href={`#${item.id}`}
                        className={cn(
                          "group flex items-center gap-2 py-1.5 text-sm transition-all duration-200",
                          item.level === 2 && "pl-4",
                          activeSection === item.id
                            ? "text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <span className={cn(
                          "w-1 h-1 rounded-full transition-all duration-200",
                          activeSection === item.id 
                            ? "bg-primary w-1.5 h-1.5" 
                            : "bg-muted-foreground/30 group-hover:bg-muted-foreground/50"
                        )} />
                        {item.label}
                      </a>
                    ))}
                  </nav>
                </div>
              </aside>
            )}
          </div>
        </div>

        {isLoggedIn && <Footer />}
      </div>
    </DocsContext.Provider>
  )
}
