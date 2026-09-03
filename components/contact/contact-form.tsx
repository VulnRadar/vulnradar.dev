"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  API,
  ROUTES,
  SUPPORT_EMAIL,
  TURNSTILE_ENABLED,
} from "@/lib/config/client-constants";
import { CATEGORIES, STAFF_ROLES } from "./contact-types";
import { TurnstileWidget } from "@/components/shared/turnstile-widget";
import { InlineAlert } from "@/components/shared/inline-alert";

/* The select and the textarea are drawn by hand rather than by the Input
   primitive, so they have to match it: rounded-md, not rounded-lg (this form
   was showing two control radii side by side), and border-input, not
   border-border. --input is the CONTROL edge and carries a real 3:1 floor;
   --border is the softer container edge, so these two fields were the only
   controls on the page drawn at container weight. */
const FIELD_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

function getPlaceholder(category: string): string {
  const placeholders: Record<string, string> = {
    bug: "What happened? Steps to reproduce, expected vs actual behavior...",
    feature: "Describe the feature you'd like to see and how it would help...",
    security:
      "Please describe the vulnerability in detail. Include steps to reproduce if possible.",
    help: "What are you trying to do, and what is happening instead?",
    billing:
      "Describe your billing issue. Include transaction IDs if relevant...",
    enterprise:
      "Tell us about your organization, team size, and security needs...",
    staff_application:
      "Why do you want to join? Share your experience and motivation...",
    feedback: "What works, what does not, and what you would change first.",
  };
  return (
    placeholders[category] ||
    "What are you trying to do, and what is happening instead?"
  );
}

/**
 * The three category notes above the submit. They were four near-identical
 * strips (`text-xs ... rounded-lg border ... px-3 py-2.5`) differing only in
 * which colour token they named, so a copy or padding fix meant four edits.
 *
 * Deliberately NOT components/shared/inline-alert: these are advisory prose
 * that is true before anything happens, not a report that something went
 * wrong, so they carry no icon and no alert role. The one real alert in this
 * form (the submit failure) does use InlineAlert.
 */
const NOTE_TONES = {
  warning:
    "border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
  muted: "border-border bg-muted/40 text-muted-foreground",
  primary: "border-primary/20 bg-primary/10 text-primary",
} as const;

function CategoryNote({
  tone,
  children,
}: {
  tone: keyof typeof NOTE_TONES;
  children: React.ReactNode;
}) {
  return (
    <p
      className={`text-xs leading-relaxed rounded-lg border px-3 py-2.5 ${NOTE_TONES[tone]}`}
    >
      {children}
    </p>
  );
}

interface ContactFormProps {
  category: string;
  onSuccess: () => void;
  onError: (error: string) => void;
}

export function ContactForm({
  category,
  onSuccess,
  onError,
}: ContactFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailLocked, setEmailLocked] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [staffRole, setStaffRole] = useState("");
  const [discord, setDiscord] = useState("");
  const [availability, setAvailability] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  // Auto-fill email from logged-in user
  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch(API.AUTH.ME);
        if (res.ok) {
          const data = await res.json();
          if (data?.email) {
            setEmail(data.email);
            setEmailLocked(true);
          }
          if (data?.name) {
            setName(data.name);
          }
        }
      } catch {
        /* not logged in */
      }
    }
    fetchUser();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (category === "staff_application" && !staffRole) {
      const msg = "Pick the role you are applying for, then send this again.";
      setError(msg);
      onError(msg);
      return;
    }

    if (TURNSTILE_ENABLED && !turnstileToken) {
      const msg =
        "The bot check above has not finished. Wait for it to tick, then send this again.";
      setError(msg);
      onError(msg);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const isStaff = category === "staff_application";
    const finalSubject = isStaff
      ? `Staff Application: ${STAFF_ROLES.find((r) => r.id === staffRole)?.label}`
      : subject;
    const finalMessage = isStaff
      ? [
          `Role: ${STAFF_ROLES.find((r) => r.id === staffRole)?.label}`,
          `Discord: ${discord || "Not provided"}`,
          `Availability: ${availability || "Not provided"}`,
          "",
          "--- Details ---",
          message,
        ].join("\n")
      : message;

    try {
      const res = await fetch(API.CONTACT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          subject: finalSubject,
          message: finalMessage,
          category,
          turnstileToken: TURNSTILE_ENABLED ? turnstileToken : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // Two different failures, and they used to share one sentence that
        // named neither: the API refused the message (below), or the request
        // never left the browser (the catch). Each now says which happened and
        // what to do next, and both offer the address that bypasses this form
        // entirely, since a broken contact form is the one bug a contact form
        // cannot be used to report.
        const errorMsg =
          data?.error ||
          `We could not accept that message and the server did not say why. Nothing was sent. Try again in a moment, or email ${SUPPORT_EMAIL} directly.`;
        setError(errorMsg);
        onError(errorMsg);
        return;
      }

      onSuccess();
    } catch {
      const errorMsg = `Your message never reached us: the request failed before it was sent. Check your connection and send again, or email ${SUPPORT_EMAIL} directly.`;
      setError(errorMsg);
      onError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  }

  const categoryInfo = CATEGORIES.find((c) => c.id === category);

  return (
    <section className="rounded-xl border border-border/50 bg-card/50">
      <header className="px-5 py-4 border-b border-border/50">
        <h3 className="text-base font-semibold tracking-tight">
          {categoryInfo?.label}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {categoryInfo?.desc}
        </p>
      </header>
      <div className="p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="contact-name"
                className="text-sm font-medium text-foreground"
              >
                Name
              </label>
              <Input
                id="contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="contact-email"
                className="text-sm font-medium text-foreground"
              >
                Email
              </label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={emailLocked}
              />
              {emailLocked && (
                <p className="text-[11px] text-muted-foreground">
                  Auto-filled from your account
                </p>
              )}
            </div>
          </div>

          {category === "staff_application" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="contact-role"
                  className="text-sm font-medium text-foreground"
                >
                  Role
                </label>
                <select
                  id="contact-role"
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value)}
                  required
                  className={FIELD_CLASS}
                >
                  <option value="">Select a role</option>
                  {STAFF_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}: {r.desc}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="contact-discord"
                    className="text-sm font-medium text-foreground"
                  >
                    Discord Username
                  </label>
                  <Input
                    id="contact-discord"
                    value={discord}
                    onChange={(e) => setDiscord(e.target.value)}
                    placeholder="username"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="contact-availability"
                    className="text-sm font-medium text-foreground"
                  >
                    Availability
                  </label>
                  <Input
                    id="contact-availability"
                    value={availability}
                    onChange={(e) => setAvailability(e.target.value)}
                    placeholder="e.g. 10 hrs/week, evenings"
                    required
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="contact-subject"
                className="text-sm font-medium text-foreground"
              >
                Subject
              </label>
              <Input
                id="contact-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of your message"
                required
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="contact-message"
              className="text-sm font-medium text-foreground"
            >
              {category === "staff_application"
                ? "Why do you want to join? (Experience, motivation, etc.)"
                : "Message"}
            </label>
            <textarea
              id="contact-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={getPlaceholder(category)}
              rows={5}
              required
              className={`${FIELD_CLASS} resize-none leading-relaxed`}
            />
          </div>

          {category === "security" && (
            <CategoryNote tone="warning">
              Security reports jump the queue. We aim to acknowledge inside 24
              hours and will tell you what we did about it.
            </CategoryNote>
          )}

          {category === "staff_application" && (
            <CategoryNote tone="muted">
              Staff roles are voluntary and unpaid. There are no set hours and
              you can step down whenever you want. Submitting this means you
              understand it is a community contribution, not employment.
            </CategoryNote>
          )}

          {category === "enterprise" && (
            <CategoryNote tone="primary">
              Enterprise covers dedicated support, custom integrations, SSO, and
              volume pricing. Expect a reply within one business day.
            </CategoryNote>
          )}

          {/* The app's one inline alert, rather than a fourth hand-rolled strip
              that had to remember role="alert" for itself. */}
          {error && <InlineAlert tone="error">{error}</InlineAlert>}

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Sending this form stores your name, email, and message so we can
            reply. Nothing here feeds a marketing list. The details are in the{" "}
            <Link
              href={ROUTES.LEGAL_PRIVACY}
              className="text-primary hover:underline underline-offset-4"
            >
              Privacy Policy
            </Link>
            .
          </p>

          {/* The submit sits at the end of the form, which is where a submit
              belongs, but it used to be `self-end` after ~700px of fields and a
              captcha widget: a small right-aligned control at the very bottom
              of a long scroll. It is an action bar now, ruled off from the
              fields, full width on mobile, and the reason it is disabled is
              stated next to it instead of leaving the user to guess. */}
          <div className="mt-1 pt-4 border-t border-border/50 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex justify-center sm:justify-start">
              <TurnstileWidget
                onVerify={setTurnstileToken}
                onExpire={() => setTurnstileToken(null)}
                className="cf-turnstile"
              />
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Button
                type="submit"
                className="w-full sm:w-auto gap-1.5"
                disabled={
                  isSubmitting || (TURNSTILE_ENABLED && !turnstileToken)
                }
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                {isSubmitting ? "Sending" : "Send message"}
              </Button>
              {TURNSTILE_ENABLED && !turnstileToken && !isSubmitting && (
                <p className="text-[11px] text-muted-foreground text-center sm:text-right">
                  Send unlocks once the bot check passes.
                </p>
              )}
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
