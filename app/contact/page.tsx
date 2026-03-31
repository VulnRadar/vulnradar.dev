"use client"

import { useState } from "react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import {
  ContactQuickLinks,
  ContactCategorySelector,
  ContactForm,
  ContactSuccess,
} from "@/components/contact"

export default function ContactPage() {
  const [category, setCategory] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleReset() {
    setSubmitted(false)
    setCategory(null)
    setError(null)
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
            <ContactCategorySelector selected={category} onSelect={setCategory} />
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
