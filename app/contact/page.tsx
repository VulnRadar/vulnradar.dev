"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import {
  ContactQuickLinks,
  ContactCategorySelector,
  ContactForm,
  ContactSuccess,
  CATEGORIES,
} from "@/components/contact"

const VALID_CATEGORIES = CATEGORIES.map((c) => c.id)

export default function ContactPage() {
  const [category, setCategory] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Handle hash-based category selection (e.g., /contact#bug)
  useEffect(() => {
    function handleHash() {
      const hash = window.location.hash.slice(1) // Remove #
      if (hash && VALID_CATEGORIES.includes(hash)) {
        setCategory(hash)
      }
    }
    handleHash()
    window.addEventListener("hashchange", handleHash)
    return () => window.removeEventListener("hashchange", handleHash)
  }, [])

  // Update URL hash when category changes
  function handleCategoryChange(newCategory: string | null) {
    setCategory(newCategory)
    if (newCategory) {
      window.history.replaceState(null, "", `#${newCategory}`)
    } else {
      window.history.replaceState(null, "", window.location.pathname)
    }
  }

  function handleReset() {
    setSubmitted(false)
    setCategory(null)
    setError(null)
    window.history.replaceState(null, "", window.location.pathname)
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <div className="flex flex-col gap-2 mb-8">
          <h1 className="text-2xl font-bold text-foreground">Contact & Support</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Need help? Found a bug? Have a great idea? {"We'd"} love to hear from you.
          </p>
        </div>

        {submitted ? (
          <ContactSuccess category={category} onReset={handleReset} />
        ) : (
          <div className="flex flex-col gap-6">
            <ContactQuickLinks />
            <ContactCategorySelector selected={category} onSelect={handleCategoryChange} />
            {category && (
              <ContactForm
                category={category}
                onSuccess={() => setSubmitted(true)}
                onError={setError}
              />
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
