"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, Check, ShieldCheck, AlertCircle } from "lucide-react";
import { APP_NAME, API } from "@/lib/config/client-constants";
import { refreshAuthCache } from "@/components/providers/auth-provider";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";
import { cn } from "@/lib/ui/utils";

interface TosModalProps {
  onAccept: () => void;
  isUpdate?: boolean;
  /** Resolved server-side through the runtime config, not this build's
   *  shipped default, so an admin's edit shows up without a rebuild. */
  termsUpdatedAt?: string;
  /** Short "what changed" note; the callout is hidden when this is empty. */
  termsChangeSummary?: string;
}

const CHECKBOXES = [
  {
    key: "terms" as const,
    title: "Legal Agreements",
    label: (
      <>
        I have read and agree to the{" "}
        <a
          href="/legal/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/40 hover:decoration-primary inline-flex items-center gap-1 transition-colors"
        >
          Terms of Service{" "}
          <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
        </a>
        ,{" "}
        <a
          href="/legal/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/40 hover:decoration-primary inline-flex items-center gap-1 transition-colors"
        >
          Privacy Policy{" "}
          <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
        </a>
        ,{" "}
        <a
          href="/legal/acceptable-use"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/40 hover:decoration-primary inline-flex items-center gap-1 transition-colors"
        >
          Acceptable Use Policy{" "}
          <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
        </a>
        , and{" "}
        <a
          href="/legal/disclaimer"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/40 hover:decoration-primary inline-flex items-center gap-1 transition-colors"
        >
          Disclaimer <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
        </a>
        .
      </>
    ),
  },
  {
    key: "authorization" as const,
    title: "Authorized Use Only",
    label: (
      <>
        I will only scan systems I{" "}
        <strong className="text-foreground font-semibold">
          own or have explicit written authorization
        </strong>{" "}
        to test. I understand that unauthorized scanning may constitute a
        criminal offense under applicable law (including the CFAA).
      </>
    ),
  },
  {
    key: "research" as const,
    title: "Legitimate Purpose",
    label: (
      <>
        I am using {APP_NAME} solely for{" "}
        <strong className="text-foreground font-semibold">
          legitimate security research, testing, or educational purposes
        </strong>
        . I will not use it for any malicious, harmful, or unauthorized
        activity.
      </>
    ),
  },
  {
    key: "datadeletion" as const,
    title: "Data Deletion Policy",
    label: (
      <>
        I acknowledge that {APP_NAME}{" "}
        <strong className="text-foreground font-semibold">
          may delete my account data, scan history, or any other information at
          any time and for any reason
        </strong>
        , including policy violations, security concerns, or routine
        maintenance. {APP_NAME} is not liable for any data loss resulting from
        deletion.
      </>
    ),
  },
  {
    key: "liability" as const,
    title: "Assumption of Liability & Jurisdiction",
    label: (
      <>
        I acknowledge that {APP_NAME} and its operators bear{" "}
        <strong className="text-foreground font-semibold">
          no liability for misuse, damages, or legal consequences
        </strong>
        . I accept full personal responsibility and agree that disputes will be
        governed by Missouri law with binding arbitration.
      </>
    ),
  },
];

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function TosModal({
  onAccept,
  isUpdate = false,
  termsUpdatedAt,
  termsChangeSummary,
}: TosModalProps) {
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [checked, setChecked] = useState({
    terms: false,
    authorization: false,
    research: false,
    datadeletion: false,
    liability: false,
  });

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 16);
    return () => clearTimeout(t);
  }, []);

  // Accepting the terms is mandatory, so this modal deliberately has no close
  // button and no backdrop-click dismissal. `onClose` is a no-op rather than
  // omitted so Escape is inert instead of silently doing nothing unhandled.
  const { dialogProps, titleProps } = useModalA11y({
    open: true,
    onClose: () => {},
  });

  const allChecked = Object.values(checked).every(Boolean);
  const checkedCount = Object.values(checked).filter(Boolean).length;

  async function handleAccept() {
    if (!allChecked) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const res = await fetch(API.AUTH.ACCEPT_TOS, { method: "POST" });
      if (res.ok) {
        // tosAcceptedAt is part of MeResponse -- keep the app-wide
        // useAuth() cache in sync too, defensively, even though TosGate
        // currently re-checks via its own direct fetch rather than that
        // cache (see the matching note in app/profile/page.tsx).
        refreshAuthCache();
        onAccept();
        return;
      }
      // This modal blocks every logged-in user until they get through it
      // (no close button, no backdrop dismissal) -- a failure here must
      // never leave them stuck with zero feedback and no way forward.
      const data = await res.json().catch(() => null);
      setAcceptError(
        data?.error || "Couldn't save your acceptance. Please try again.",
      );
    } catch {
      setAcceptError(
        "Couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setAccepting(false);
    }
  }

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px) scale(0.99); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes checkPop {
          0%   { transform: scale(0.6); opacity: 0; }
          60%  { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        .tos-backdrop { animation: fadeIn 0.25s ease forwards; }
        .tos-modal   { animation: fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .tos-item-1  { animation: fadeUp 0.38s 0.13s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-2  { animation: fadeUp 0.38s 0.20s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-3  { animation: fadeUp 0.38s 0.27s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-4  { animation: fadeUp 0.38s 0.34s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-5  { animation: fadeUp 0.38s 0.41s cubic-bezier(0.16,1,0.3,1) both; }
        .check-pop   { animation: checkPop 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards; }
      `}</style>

      {/* ── Backdrop ── */}
      <div
        className={`fixed inset-0 z-100 flex items-end sm:items-center justify-center sm:p-4 ${mounted ? "tos-backdrop" : "opacity-0"}`}
      >
        <div className="absolute inset-0 bg-background/65 backdrop-blur-xl" />

        {/* ── Modal card ── */}
        <div
          {...dialogProps}
          className={`relative w-full sm:max-w-[432px] rounded-t-3xl sm:rounded-2xl border border-border/50 flex flex-col overflow-hidden outline-hidden ${mounted ? "tos-modal" : "opacity-0"}`}
          style={{
            background: "hsl(var(--card))",
            maxHeight: "calc(100dvh - 48px)",
            boxShadow:
              "0 0 0 1px hsl(var(--border)/0.4), 0 24px 64px -8px hsl(0 0% 0% / 0.35), 0 8px 20px -4px hsl(0 0% 0% / 0.15)",
          }}
        >
          {/* ── Header ── */}
          <div className="px-6 pt-6 pb-4 border-b border-border/40 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  "font-mono text-[10px] font-semibold uppercase tracking-[0.14em]",
                  isUpdate ? "text-[hsl(var(--warning))]" : "text-primary/70",
                )}
              >
                {isUpdate ? "terms · updated" : "terms of service"}
              </span>
              {/* Five discrete ticks, one per checkbox below -- not an
                  abstract percentage, exactly what's left to confirm. */}
              <div
                className="flex items-center gap-1"
                role="img"
                aria-label={`${checkedCount} of 5 confirmed`}
              >
                {CHECKBOXES.map(({ key }) => (
                  <span
                    key={key}
                    className={cn(
                      "h-1 w-4 rounded-full transition-colors duration-200",
                      checked[key] ? "bg-primary" : "bg-border/50",
                    )}
                  />
                ))}
              </div>
            </div>

            <h2
              {...titleProps}
              className="text-xl font-bold text-foreground mt-2"
            >
              {isUpdate ? "We updated the terms" : "Before you start scanning"}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {isUpdate
                ? termsUpdatedAt
                  ? `Updated ${formatDate(termsUpdatedAt)}`
                  : "Please review and accept the updated terms"
                : "Five things to confirm. Takes about 20 seconds."}
            </p>

            {/* Update callout - the only genuinely new information here,
                so it's the only callout kept. The non-update case used to
                repeat "authorized security testing only" in a floating box
                right above a checkbox that says the same thing -- that
                checkbox (below) now carries the weight instead. */}
            {isUpdate && termsChangeSummary && (
              <div className="mt-4 p-3 rounded-lg border border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/5 flex gap-3">
                <AlertCircle
                  className="h-4 w-4 text-[hsl(var(--warning))] shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="flex-1">
                  <p className="text-xs text-foreground font-medium mb-1">
                    What changed
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {termsChangeSummary}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Checkboxes ── */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 overscroll-contain">
            {CHECKBOXES.map(({ key, title, label }, i) => {
              // The one item with actual legal teeth (unauthorized scanning
              // can be a federal crime) was previously styled identically
              // to "we might delete your data for maintenance" -- same
              // eyebrow, same checkbox, same row. It gets real emphasis
              // here instead; the other four stay quiet by comparison.
              const critical = key === "authorization";
              return (
                <label
                  key={key}
                  htmlFor={`tos-${key}`}
                  className={cn(
                    `tos-item-${i + 1} flex items-start gap-3 cursor-pointer rounded-lg pl-3 pr-3 py-3 -mx-3 border-l-2 transition-colors duration-150 has-focus-visible:ring-2 has-focus-visible:ring-ring`,
                    critical
                      ? checked[key]
                        ? "border-l-[hsl(var(--warning))] bg-[hsl(var(--warning))]/5"
                        : "border-l-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/5 hover:bg-[hsl(var(--warning))]/5"
                      : checked[key]
                        ? "border-l-transparent bg-muted/50"
                        : "border-l-transparent hover:bg-muted/30",
                  )}
                  style={{ opacity: 0 }}
                >
                  {/* A real, focusable checkbox drives the state so this row
                      works from the keyboard and announces correctly to a
                      screen reader. The div below is its purely decorative
                      visual; the label's click-forwarding to the native input
                      already makes the whole row clickable, so no manual
                      onClick is needed here. */}
                  <input
                    id={`tos-${key}`}
                    type="checkbox"
                    checked={checked[key]}
                    onChange={() =>
                      setChecked((p) => ({ ...p, [key]: !p[key] }))
                    }
                    className="sr-only"
                  />

                  {/* Checkbox */}
                  <div
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 rounded-md flex items-center justify-center shrink-0 transition-all duration-200",
                      checked[key]
                        ? critical
                          ? "bg-[hsl(var(--warning))] border-[hsl(var(--warning))]"
                          : "bg-primary border-primary"
                        : "border border-border/50 bg-background",
                    )}
                    style={{ width: 18, height: 18, minWidth: 18 }}
                  >
                    {checked[key] && (
                      <span className="check-pop">
                        <Check
                          strokeWidth={3}
                          className={
                            critical
                              ? "text-[hsl(var(--warning-foreground))]"
                              : "text-primary-foreground"
                          }
                          style={{ width: 10, height: 10 }}
                        />
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[10px] text-muted-foreground/40">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p
                        className={cn(
                          "text-xs font-semibold uppercase tracking-wide transition-colors",
                          critical
                            ? "text-[hsl(var(--warning))]"
                            : checked[key]
                              ? "text-primary"
                              : "text-muted-foreground/60",
                        )}
                      >
                        {title}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {label}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 border-t border-border/40 shrink-0 space-y-3">
            {acceptError && (
              <p role="alert" className="text-sm text-destructive text-center">
                {acceptError}
              </p>
            )}
            <Button
              onClick={handleAccept}
              disabled={!allChecked || accepting}
              className="w-full h-10 text-sm font-semibold"
            >
              {accepting ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Processing
                </span>
              ) : allChecked ? (
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  {isUpdate ? "Accept updated terms" : "I agree and continue"}
                </span>
              ) : (
                `${checkedCount} of 5 confirmed`
              )}
            </Button>

            <div className="flex items-center justify-center gap-1">
              <p className="text-xs text-muted-foreground/60">
                By continuing, you agree to
              </p>
              <a
                href="/legal/disclaimer"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
              >
                full terms
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
