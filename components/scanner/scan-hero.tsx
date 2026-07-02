"use client";

import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants";

const PILLS = [
  "Security headers",
  "SSL/TLS config",
  "Cookie security",
  "CORS policy",
  "Mixed content",
  `${TOTAL_CHECKS_LABEL} checks total`,
];

export function ScanHero() {
  return (
    <section aria-label="Scanner" className="pt-8 sm:pt-12 pb-5 text-center">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
        Scan Your Website for Vulnerabilities
      </h1>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
        Enter any URL to run security checks across headers, SSL, cookies, content, and configuration.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
        {PILLS.map((pill) => (
          <span
            key={pill}
            className="text-xs px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground"
          >
            {pill}
          </span>
        ))}
      </div>
    </section>
  );
}
