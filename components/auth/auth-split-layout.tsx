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
      body: `Scans kept for ${BILLING_HISTORY_RETENTION.free} days on the free plan, so you can diff today against last week.`,
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
    <div className="relative overflow-hidden min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
      {/* Left: why the account is worth having. Desktop only, because on a
          phone it would push the form below the fold. */}
      <aside className="hidden lg:flex flex-col relative z-10">
        {/* One soft, off-center light source low behind the readout, not a
            texture repeated across the whole page. The readout is the only
            thing here that's actually ours; this just gives it somewhere to
            sit rather than floating on a flat panel. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-24 z-0 h-[420px] w-[420px] rounded-full bg-primary/8 blur-[100px]"
        />

        <div className="relative z-10 flex flex-col h-full p-10 xl:p-14">
          <AuthWordmark />

          <div className="flex-1 flex flex-col justify-center py-10">
            <div className="max-w-[360px]">
              <h2 className="text-[28px] leading-[1.15] font-semibold tracking-tight text-foreground">
                Paste a URL. Get findings,
                <br />
                not a grade out of ten.
              </h2>
              <p className="mt-3.5 text-sm text-muted-foreground leading-relaxed">
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
                    <dd className="text-sm text-muted-foreground leading-relaxed mt-0.5">
                      {r.body}
                    </dd>
                  </div>
                ))}
              </dl>

              <ResponseReadout
                size="sm"
                host="yourdomain.com"
                rows={AUTH_READOUT_ROWS}
                leadCheckId="csp-missing"
                className="mt-12 max-w-[300px]"
              />
            </div>
          </div>

          <AuthFooter />
        </div>
      </aside>

      {/* Right: the task itself. */}
      <div className="relative z-10 flex flex-col min-h-screen lg:min-h-0">
        <header className="px-5 sm:px-8 pt-6 pb-2 shrink-0 lg:hidden">
          <AuthWordmark />
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-5 sm:px-8 py-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>

        <AuthFooter className="px-5 sm:px-8 pb-6 pt-2 lg:hidden" />
      </div>
    </div>
  );
}
