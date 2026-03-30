"use client"

import { useState, useEffect, createContext, useContext } from "react"
import { usePathname } from "next/navigation"
import { BookOpen, Zap, Code2, Webhook, Gauge } from "lucide-react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { useAuth } from "@/components/providers/auth-provider"
import {
  DocsSidebar,
  DocsToc,
  DocsMobileNavTrigger,
  DocsMobileNav,
  DocsHeader,
  type TocItem,
  type NavItem,
} from "@/components/docs"

// Context for sharing active section state between layout and pages
interface DocsContextType {
  activeSection: string
  setActiveSection: (section: string) => void
  tocItems: TocItem[]
  setTocItems: (items: TocItem[]) => void
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

// Re-export TocItem for page imports
export type { TocItem }

const mainNavItems: NavItem[] = [
  { href: "/docs", label: "Getting Started", icon: BookOpen, exact: true },
  { href: "/docs/api", label: "API Reference", icon: Zap },
  { href: "/docs/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/docs/rate-limits", label: "Rate Limits", icon: Gauge },
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
        {isLoggedIn ? <Header /> : <DocsHeader />}

        <div className="flex-1 max-w-[90rem] w-full mx-auto">
          <div className="flex">
            <DocsSidebar navItems={mainNavItems} />

            <DocsMobileNavTrigger onToggle={() => setMobileNavOpen(!mobileNavOpen)} />

            <DocsMobileNav
              navItems={mainNavItems}
              tocItems={tocItems}
              activeSection={activeSection}
              isOpen={mobileNavOpen}
              onToggle={() => setMobileNavOpen(!mobileNavOpen)}
              onClose={() => setMobileNavOpen(false)}
            />

            {/* Main Content */}
            <main className="flex-1 min-w-0 px-3 sm:px-6 lg:px-10 py-6 sm:py-8 lg:py-10">
              <article className="max-w-4xl mx-auto lg:mx-0">{children}</article>
            </main>

            <DocsToc items={tocItems} activeSection={activeSection} />
          </div>
        </div>

        <Footer />
      </div>
    </DocsContext.Provider>
  )
}
