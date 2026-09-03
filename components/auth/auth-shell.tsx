"use client";

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { focus, transitions } from "@/lib/ui/animations";
import {
  checkPasswordRequirements,
  type PasswordRequirementContext,
} from "@/lib/auth/password-strength";

/**
 * Shared building blocks for the auth flow. Every screen in the flow is one
 * task, so they all use the same three pieces: where you are (AuthSteps),
 * what you are doing (AuthHeading), and what went wrong or what happened
 * (AuthAlert / AuthOutcome).
 */

/** Input and control focus ring. The shadcn primitives clear the outline and
 *  do not draw a replacement, so every interactive element in this flow
 *  opts back in explicitly. */
export const authFocusRing = focus.ring;

export const authFieldClass = cn(
  "h-11 border-border/60 bg-background",
  "focus-visible:border-primary/60",
  authFocusRing,
);

/** The bordered pill every secondary action in the flow wears (back to sign
 *  in, back to landing, resend, switch method). It was copied inline in four
 *  files and skipped entirely on the 2FA screen, which left that screen's
 *  actions as naked text with no hit area to aim at. */
export const authPillClass = cn(
  "inline-flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-muted/40",
  "px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
  "disabled:opacity-50",
  transitions.colors,
  authFocusRing,
);

function useFocusOnMount(enabled: boolean) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (enabled) ref.current?.focus();
  }, [enabled]);
  return ref;
}

export function AuthSteps({
  current,
  total,
  className,
}: {
  current: number;
  total: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5 mb-5", className)}>
      <div className="flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-[3px] w-7 rounded-full transition-colors duration-200",
              i < current ? "bg-primary" : "bg-border",
            )}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        Step {current} of {total}
      </span>
    </div>
  );
}

/** Tier B, the sub-page title size. In the split layout the left pitch
 *  heading is the page's display heading, so the form column's heading
 *  labels a panel rather than selling the page. It was `text-2xl` flat,
 *  which is a third H1 size belonging to neither tier. */
const authHeadingClass =
  "text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground";

export function AuthHeading({
  title,
  description,
  focusOnMount = false,
}: {
  title: string;
  description?: React.ReactNode;
  focusOnMount?: boolean;
}) {
  const ref = useFocusOnMount(focusOnMount);
  return (
    <div className="mb-6">
      <h1
        ref={ref}
        tabIndex={-1}
        className={cn(authHeadingClass, "outline-hidden", authFocusRing)}
      >
        {title}
      </h1>
      {description ? (
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          {description}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The keyline + title + body of an outcome screen, on its own so a screen
 * that needs a different focus target (verify-email-expired autofocuses its
 * email field, not the heading) can render the same header instead of
 * hand-rolling a copy that drifts.
 */
export function AuthOutcomeHeader({
  tone,
  title,
  headingRef,
  className,
  children,
}: {
  tone: "positive" | "negative";
  title: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-l-2 pl-4",
        tone === "negative" ? "border-destructive" : "border-primary",
        className,
      )}
    >
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className={cn(authHeadingClass, "outline-hidden", authFocusRing)}
      >
        {title}
      </h1>
      {children ? (
        <div className="mt-2 text-sm text-muted-foreground leading-relaxed space-y-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A screen that has finished: link sent, password changed, token dead.
 * A coloured keyline carries the outcome rather than a large icon badge,
 * and the recovery action is always on screen so the screen is never a
 * dead end.
 */
export function AuthOutcome({
  tone,
  title,
  children,
  actions,
  footnote,
}: {
  tone: "positive" | "negative";
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  const ref = useFocusOnMount(true);
  return (
    <div>
      <AuthOutcomeHeader tone={tone} title={title} headingRef={ref}>
        {children}
      </AuthOutcomeHeader>
      {actions ? <div className="mt-7 space-y-2.5">{actions}</div> : null}
      {footnote ? (
        <p className="mt-5 text-xs text-muted-foreground/70 leading-relaxed">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

/** Inline failure or notice attached to a form. Announced on insert. */
export function AuthAlert({
  children,
  tone = "error",
  action,
}: {
  children: React.ReactNode;
  tone?: "error" | "info";
  action?: React.ReactNode;
}) {
  const Icon = tone === "error" ? AlertTriangle : Info;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border px-3.5 py-3",
        tone === "error"
          ? "border-destructive/25 bg-destructive/5"
          : "border-primary/25 bg-primary/5",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 mt-px",
            tone === "error" ? "text-destructive" : "text-primary",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div
            className={cn(
              "text-sm leading-relaxed",
              tone === "error" ? "text-destructive" : "text-foreground",
            )}
          >
            {children}
          </div>
          {action}
        </div>
      </div>
    </div>
  );
}

/**
 * Strength meter plus the hard requirement checklist, for the two screens
 * that set a password. The bar is advisory (from analyzePassword's score);
 * the checklist below it is the same pass/fail gate the server enforces, so
 * nothing shown as "met" here can still be rejected on submit.
 *
 * Every item is a checkmark-or-dash plus a written label, never colour or
 * icon shape alone, so it reads the same for someone who cannot see either.
 */
export function PasswordStrengthMeter({
  password,
  level,
  label,
  hint,
  id,
  context,
  omitIds,
}: {
  password: string;
  level: number;
  label: string;
  hint?: string;
  id: string;
  context?: PasswordRequirementContext;
  /** Requirement ids to compute (so they still gate submission) but not
   *  display. Used where the page has no email or name to check the
   *  password against yet, so showing "doesn't contain your email" would
   *  claim a check that isn't actually running. */
  omitIds?: string[];
}) {
  const requirements = useMemo(
    () => checkPasswordRequirements(password, context ?? {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [password, context?.email, context?.name],
  );
  const visibleRequirements = omitIds
    ? requirements.filter((r) => !omitIds.includes(r.id))
    : requirements;

  return (
    <div className="mt-2.5 space-y-2.5">
      <div className="space-y-1.5">
        <div className="flex gap-1 h-[3px]" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((idx) => (
            <span
              key={idx}
              className={cn(
                "h-full flex-1 rounded-full transition-colors duration-200",
                level >= idx
                  ? level <= 1
                    ? "bg-destructive"
                    : "bg-primary"
                  : "bg-muted",
              )}
            />
          ))}
        </div>
        <p id={id} className="text-xs text-muted-foreground">
          Strength: <span className="font-medium text-foreground">{label}</span>
          {hint ? <span className="block mt-1">{hint}</span> : null}
        </p>
      </div>

      <ul
        aria-live="polite"
        className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2"
      >
        {visibleRequirements.map((r) => (
          <li
            key={r.id}
            className={cn(
              "flex items-center gap-1.5 text-xs",
              r.met ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {r.met ? (
              <Check
                className="h-3 w-3 shrink-0 text-primary"
                aria-hidden="true"
              />
            ) : (
              <X
                className="h-3 w-3 shrink-0 text-muted-foreground/50"
                aria-hidden="true"
              />
            )}
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
