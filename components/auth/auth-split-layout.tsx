"use client";

import { AuthFooter, AuthWordmark } from "@/components/auth/auth-layout";
import {
  BILLING_ENABLED,
  BILLING_HISTORY_RETENTION,
  BILLING_PLAN_LIMITS,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/constants";
import {
  ResponseReadout,
  type ResponseReadoutRow,
} from "@/components/shared/response-readout";

/**
 * The calm sibling of the landing hero's readout: fewer lines, same real
 * header names and severities, a generic host since this isn't tied to a
 * specific scan. Quiet on purpose, this rail is selling the account, not
 * the visual.
 */
const AUTH_READOUT_ROWS: ResponseReadoutRow[] = [
  { header: "strict-transport-security", state: "pass", detail: "present" },
  { header: "x-frame-options", state: "pass", detail: "present" },
  {
    header: "content-security-policy",
    state: "fail",
    detail: "missing",
    severity: "high",
  },
];

function accountReasons(): { label: string; body: string }[] {
  if (!BILLING_ENABLED) {
    return [
      {
        label: "History",
        body: "Every scan is kept and diffable, so you can see what changed since last week rather than re-reading a fresh report.",
      },
      {
        label: "API keys",
        body: "Same engine over HTTP. Run it from CI and fail the build on a finding ID.",
      },
      {
        label: "Schedules and webhooks",
        body: "A regression pages you instead of waiting to be noticed.",
      },
    ];
  }
  return [
    {
      label: "History",
      // Same -1 = unlimited sentinel guard as the pricing surfaces: this read
      // "Scans kept for -1 days" on the login and signup pages.
      body:
        BILLING_HISTORY_RETENTION.free === -1
          ? "Every scan is kept on the free plan, so you can diff today against last week."
          : `Scans kept for ${BILLING_HISTORY_RETENTION.free} days on the free plan, so you can diff today against last week.`,
    },
    {
      label: "API keys",
      body: `Same engine over HTTP, ${BILLING_PLAN_LIMITS.free} scans a day free. Run it from CI and fail the build on a finding ID.`,
    },
    {
      label: "Schedules and webhooks",
      body: "A regression pages you instead of waiting to be noticed.",
    },
  ];
}

interface AuthSplitLayoutProps {
  children: React.ReactNode;
}

export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  const reasons = accountReasons();

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* One canvas, not two panels. A single off-center light source sits
          behind the whole composition so both sides share the same ground.
          No tinted panel, no divider: the pitch and the form are the same
          surface, held together by the centered layout below. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 left-[22%] z-0 h-[620px] w-[620px] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-[130px]"
      />

      <header className="relative z-10 px-6 pt-6 pb-2 sm:px-10">
        <AuthWordmark />
      </header>

      {/* The dead space is solved by composition, not a background: the pitch
          and the form are pulled into one centered, bounded band, so the empty
          room becomes symmetric outer margin instead of a gap down the middle. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="relative z-10 flex flex-1 items-center justify-center px-6 py-10 sm:px-10"
      >
        <div className="grid w-full max-w-6xl items-center gap-y-12 lg:grid-cols-2 lg:gap-x-16 xl:gap-x-28">
          {/* The pitch. Desktop only; on a phone it would push the form below
              the fold. */}
          <div className="hidden max-w-md lg:block">
            <h2 className="text-[28px] font-semibold leading-[1.15] tracking-tight text-foreground">
              Paste a URL. Get findings,
              <br />
              not a grade out of ten.
            </h2>
            <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">
              {TOTAL_CHECKS_LABEL} checks run in parallel against the live
              response. Every finding comes back with a stable ID you can
              reference in a pull request or gate a build on.
            </p>

            <dl className="mt-7 space-y-3.5 border-l border-border/60 pl-4">
              {reasons.map((r) => (
                <div key={r.label}>
                  <dt className="text-sm font-medium text-foreground">
                    {r.label}
                  </dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {r.body}
                  </dd>
                </div>
              ))}
            </dl>

            {/* The response readout as itself. It carries its own built-in
                staggered reveal; nothing is layered on top of the card. */}
            <ResponseReadout
              size="sm"
              host="yourdomain.com"
              rows={AUTH_READOUT_ROWS}
              leadCheckId="csp-missing"
              className="mt-12 max-w-[300px]"
            />
          </div>

          {/* The task. */}
          <div className="mx-auto w-full max-w-sm">{children}</div>
        </div>
      </main>

      <AuthFooter className="relative z-10 px-6 pb-6 pt-2 sm:px-10" />
    </div>
  );
}
