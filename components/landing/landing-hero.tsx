"use client";

import Link from "next/link";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/client-constants";
import { useAuth } from "@/components/providers/auth-provider";
import {
  ResponseReadout,
  type ResponseReadoutRow,
} from "@/components/shared/response-readout";

interface LandingHeroProps {
  /** Real count from the scanner registry, not a marketing label. */
  checkCount: string;
  categoryCount: number;
}

/**
 * One illustrative pass of the header checks. Real header names, real
 * severities (pulled from lib/scanner/checks-data/headers.json), a generic
 * host, not the real scan target, so nothing here reads as a live claim
 * about a specific site.
 */
const HERO_READOUT_ROWS: ResponseReadoutRow[] = [
  { header: "strict-transport-security", state: "pass", detail: "present" },
  {
    header: "content-security-policy",
    state: "fail",
    detail: "missing",
    severity: "high",
  },
  { header: "x-frame-options", state: "pass", detail: "present" },
  {
    header: "x-content-type-options",
    state: "fail",
    detail: "missing",
    severity: "medium",
  },
  {
    header: "set-cookie",
    state: "warn",
    detail: "missing Secure flag",
    severity: "high",
  },
  {
    header: "referrer-policy",
    state: "fail",
    detail: "missing",
    severity: "low",
  },
];

export function LandingHero({ checkCount, categoryCount }: LandingHeroProps) {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  const stats: [string, string][] = [
    [checkCount, "checks"],
    [String(categoryCount), "categories"],
    ["<3s", "per scan"],
    ["GPL-3.0", "licensed"],
  ];

  return (
    <section className="pt-12 pb-14 sm:pt-20 sm:pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-10 lg:gap-16 items-start">
          <div>
            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-semibold tracking-tight leading-[1.06] mb-6 text-balance">
              Scan any website
              <br />
              for security issues.
            </h1>

            {/* Two paragraphs, not one. The first names who this is for,
                which the page did not answer until section six, and the
                second answers "why not the free header checkers", which it
                did not answer at all. */}
            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-4 max-w-xl text-pretty">
              For the developer who wants to know whether what they just shipped
              has a hole in it, and for whoever is responsible for every domain
              the company owns, including the four nobody remembers. Paste a URL
              and the request goes out from our servers, not your browser:{" "}
              {checkCount} checks come back with the response evidence behind
              each one, a finding ID that does not change between runs, and a
              config snippet you can paste straight into Nginx, Caddy, Express,
              or Next.js.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-xl text-pretty">
              The free header checkers give you a letter grade and stop. This
              gives you the rule that fired, the bytes it fired on, and the fix.
              The whole engine is GPL-3.0 in the public repo, so you can read
              every check or run the lot yourself.
            </p>

            <div className="flex flex-wrap gap-3 mb-10">
              {isLoggedIn ? (
                <Link href={ROUTES.DASHBOARD}>
                  <Button size="lg" className="h-11 px-6 gap-2">
                    <LayoutDashboard className="h-4 w-4" />
                    Go to Dashboard
                  </Button>
                </Link>
              ) : (
                <Link href={ROUTES.SIGNUP}>
                  <Button size="lg" className="h-11 px-6 gap-2">
                    Start scanning free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              )}
              <Link href={ROUTES.DEMO}>
                <Button size="lg" variant="outline" className="h-11 px-6">
                  Try the demo
                </Button>
              </Link>
            </div>

            <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-border/50 pt-5">
              {stats.map(([value, label]) => (
                <div key={label} className="flex items-baseline gap-1.5">
                  <dt className="sr-only">{label}</dt>
                  <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {value}
                  </dd>
                  <span
                    aria-hidden="true"
                    className="text-sm text-muted-foreground"
                  >
                    {label}
                  </span>
                </div>
              ))}
            </dl>
          </div>

          <div className="lg:pt-1.5">
            <ResponseReadout
              size="lg"
              host="example.com"
              rows={HERO_READOUT_ROWS}
              leadCheckId="csp-missing"
              className="shadow-xs shadow-black/5 dark:shadow-black/20"
            />
            {/* Was "no rendering, no screenshot, just the response", which
                described a headers-only scanner and was also untrue: the
                engine takes page screenshots and drives a real browser for
                authenticated logins. Naming the breadth is both accurate and
                the stronger claim, since the free tools this competes with
                each cover one slice of it. */}
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              Six lines out of {checkCount} checks. The same request grades the
              certificate and the TLS handshake, reads SPF, DKIM and DMARC,
              checks every cookie attribute, and looks through what the page
              ships for exposed secrets.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
