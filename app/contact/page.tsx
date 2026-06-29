"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import {
  ContactQuickLinks,
  ContactCategorySelector,
  ContactForm,
  ContactSuccess,
  CATEGORIES,
} from "@/components/contact";
import { getQueryParam, setQueryParam } from "@/lib/ui/url-state";

const VALID_CATEGORIES = CATEGORIES.map((c) => c.id);

export default function ContactPage() {
  const [category, setCategory] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [_error, setError] = useState<string | null>(null);

  // Handle query param-based category selection (e.g., /contact?category=bug)
  useEffect(() => {
    const initial = getQueryParam("category");
    if (initial && VALID_CATEGORIES.includes(initial)) {
      setCategory(initial);
    }
  }, []);

  // Update URL query param when category changes
  function handleCategoryChange(newCategory: string | null) {
    setCategory(newCategory);
    setQueryParam("category", newCategory, { replace: true });
  }

  function handleReset() {
    setSubmitted(false);
    setCategory(null);
    setError(null);
    setQueryParam("category", null, { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <div className="mb-8 sm:mb-10">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Contact & Support
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed mt-1 max-w-xl">
            Need help? Found a bug? Have a great idea? {"We'd"} love to hear
            from you.
          </p>
        </div>

        {submitted ? (
          <ContactSuccess category={category} onReset={handleReset} />
        ) : (
          <div className="flex flex-col gap-6">
            <ContactQuickLinks />
            <ContactCategorySelector
              selected={category}
              onSelect={handleCategoryChange}
            />
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
  );
}
