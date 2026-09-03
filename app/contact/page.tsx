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
      {/* Tier A, verbatim: this page is the whole reason a visitor is here.
          The trailing text-foreground the heading used to carry belongs to
          Tier B, where the wrapper is muted; nothing mutes this one. */}
      <header className={submitted ? "mb-8" : "mb-4"}>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance">
          Contact
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Bugs, false positives, feature ideas, security disclosures, or
          enterprise deployments: pick a category and it goes to the right
          place.
        </p>
      </header>

      {submitted ? (
        <ContactSuccess category={category} onReset={handleReset} />
      ) : (
        /* Three weights, deliberately not one template three times: the quick
           links are a sentence attached to the intro above (hence sitting in
           the header's own spacing rather than as a third equal block), the
           category picker is the panel that carries the page, and the form is
           the card that appears once a choice is made. This was three stacked
           blocks at gap-8, two of them opening with the same
           `h2 text-sm font-medium` label. */
        <>
          <div className="mb-8">
            <ContactQuickLinks />
          </div>
          <div className="flex flex-col gap-8">
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
        </>
      )}
    </PublicPageShell>
  );
}
