"use client";

import { useState, useEffect } from "react";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import {
  ContactQuickLinks,
  ContactCategorySelector,
  ContactForm,
  ContactSuccess,
  SupportTickets,
  CATEGORIES,
} from "@/components/contact";
import {
  getQueryParam,
  getQueryParamInt,
  setQueryParam,
} from "@/lib/ui/url-state";

const VALID_CATEGORIES = CATEGORIES.map((c) => c.id);

export default function ContactPage() {
  const [category, setCategory] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [_error, setError] = useState<string | null>(null);

  // Handle query param-based category selection (e.g., /contact?category=bug).
  // A ?ticket=N deep link (from the ticket notification email / bell) opens the
  // Support Ticket category so <SupportTickets> mounts and reads the id itself.
  useEffect(() => {
    const ticketId = getQueryParamInt("ticket");
    const initial = getQueryParam("category");
    if (ticketId && ticketId > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL's query string (an external system) to seed initial state
      setCategory("ticket");
    } else if (initial && VALID_CATEGORIES.includes(initial)) {
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
    <PublicPageShell maxWidth="max-w-2xl" padding="py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Contact
        </h1>
        <p className="text-muted-foreground leading-relaxed mt-2">
          Bugs, false positives, feature ideas, security disclosures, or
          enterprise deployments: pick a category and it goes to the right
          place.
        </p>
      </header>

      {submitted ? (
        <ContactSuccess category={category} onReset={handleReset} />
      ) : (
        <div className="flex flex-col gap-8">
          <ContactQuickLinks />
          <ContactCategorySelector
            selected={category}
            onSelect={handleCategoryChange}
          />
          {/* "Support Ticket" opens the tracked, two-way thread with staff
              (SupportTickets manages its own state and sign-in prompt). Every
              other category is the fire-and-forget anonymous contact form. */}
          {category === "ticket" ? (
            <SupportTickets />
          ) : category ? (
            <ContactForm
              category={category}
              onSuccess={() => setSubmitted(true)}
              onError={setError}
            />
          ) : null}
        </div>
      )}
    </PublicPageShell>
  );
}
