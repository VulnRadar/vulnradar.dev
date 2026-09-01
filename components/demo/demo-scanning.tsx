"use client";

import { Loader2 } from "lucide-react";
import { TOTAL_CHECKS_LABEL } from "@/lib/config/client-constants";

const STEPS = [
  "Resolving the host and opening the connection",
  "Reading response headers and cookie flags",
  "Completing the TLS handshake and walking the certificate chain",
  "Resolving DNS, SPF, DMARC, and CAA records",
  "Parsing the HTML and linked JavaScript for exposed secrets",
];

export function DemoScanning() {
  return (
    <section className="pt-16 pb-20 sm:pt-24">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <p
          className="flex items-center gap-2 text-sm font-mono text-primary mb-4"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Scanning
        </p>

        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3 text-balance">
          Running {TOTAL_CHECKS_LABEL} checks
        </h1>
        <p className="text-muted-foreground leading-relaxed mb-8">
          Modules run in parallel, so this is usually over in a couple of
          seconds. A slow DNS resolver or a long certificate chain can stretch
          it out.
        </p>

        <ul className="border-t border-border/50 divide-y divide-border/50 text-sm">
          {STEPS.map((step) => (
            <li
              key={step}
              className="py-3 flex gap-3 text-muted-foreground leading-relaxed"
            >
              <span
                aria-hidden="true"
                className="mt-2 h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0"
              />
              {step}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
