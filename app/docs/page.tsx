"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Globe,
  Key,
  Webhook,
  Gauge,
  Server,
  Cpu,
  Settings,
  Code2,
} from "lucide-react";
import {
  APP_NAME,
  APP_URL,
  APP_VERSION,
  APP_REPO,
  ENGINE_VERSION,
  TOTAL_CHECKS_LABEL,
  API_CURRENT_VERSION,
} from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "./layout";
import {
  DocsHero,
  DocsSection,
  DocsFeatureGrid,
  DocsSteps,
  CopyButton,
  type Feature,
  type Step,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "features", label: "Features" },
  { id: "quick-start", label: "Quick Start" },
  { id: "documentation", label: "Documentation" },
  { id: "support", label: "Support" },
];

const platformFeatures: Feature[] = [
  {
    icon: Cpu,
    title: TOTAL_CHECKS_LABEL,
    description: "Detection checks across HTTP, TLS, cookies, headers, content",
  },
  {
    icon: Globe,
    title: "Six Protocols",
    description: "http, https, ws, wss, ftp, ftps",
  },
  {
    icon: Key,
    title: "API Access",
    description: "REST v3 with Bearer tokens, encrypted at rest",
  },
  {
    icon: Webhook,
    title: "Webhooks",
    description: "Discord, Slack, and generic HTTPS endpoints",
  },
  {
    icon: Server,
    title: "Self-Hostable",
    description: "Single Next.js process + PostgreSQL, GPL-3.0",
  },
  {
    icon: Settings,
    title: "Configurable",
    description: "Static config in TypeScript, secrets in environment",
  },
];

const quickStartSteps: Step[] = [
  {
    step: 1,
    title: "Create an account",
    description:
      "Sign up at the app or self-host and create the first user via signup.",
  },
  {
    step: 2,
    title: "Generate an API key",
    description:
      "Open Profile -> API Keys -> Generate New Key. Store the raw key; it is shown only once.",
  },
  {
    step: 3,
    title: "Make your first scan",
    description: "POST /api/v3/scan with the target URL and your Bearer token.",
  },
  {
    step: 4,
    title: "Read the results",
    description:
      "Findings are ranked by severity, each with a CVSS score and a fix recipe.",
  },
];

const docSections = [
  {
    icon: Code2,
    title: "API Reference",
    subtitle: "v3 REST API",
    description:
      "Complete reference for the v3 REST API: authentication, scan endpoints, history, webhooks, billing.",
    features: [
      "Bearer token authentication (AES-256 at rest)",
      "Scan, bulk, crawl, and history endpoints",
      "Per-key daily quotas and rate-limit headers",
    ],
    href: "/docs/api",
  },
  {
    icon: Server,
    title: "Setup Guide",
    subtitle: "Local + Docker",
    description:
      "Step-by-step instructions for installing VulnRadar locally or shipping a production build.",
    features: [
      "Prerequisites (Node 22 LTS, PostgreSQL 14+)",
      "Environment variables and config",
      "Docker and bare-Node deployment",
    ],
    href: "/docs/setup",
  },
  {
    icon: Gauge,
    title: "Rate Limits",
    subtitle: "Daily quotas",
    description:
      "Per-API-key daily quotas, per-IP rate limits, and the headers you receive on every response.",
    features: [
      "Plan-based daily quotas (Free/Core/Pro/Elite)",
      "Per-IP limits on auth endpoints",
      "Retry-After and X-RateLimit-* headers",
    ],
    href: "/docs/rate-limits",
  },
  {
    icon: Settings,
    title: "Configuration",
    subtitle: "lib/config/config-values.ts",
    description:
      "All non-secret tunables live in lib/config/config-values.ts. Secrets live in environment variables.",
    features: [
      "App metadata, branding, emails",
      "Rate limits, feature flags, billing limits",
      "Self-hosting checklist",
    ],
    href: "/docs/config",
  },
  {
    icon: Cpu,
    title: "Architecture",
    subtitle: "Codebase map",
    description:
      "Project layout, key subsystems, request lifecycle, and the CI/CD pipeline.",
    features: [
      "lib/, app/, scripts/, components/",
      "Auth, scanner, billing, permissions",
      "GitHub Actions and Dockerfile",
    ],
    href: "/docs/architecture",
  },
  {
    icon: Webhook,
    title: "Webhooks",
    subtitle: "Discord / Slack / Generic",
    description:
      "Receive real-time notifications when scans complete. Five webhooks per user, HTTPS only.",
    features: [
      "Auto-detect by URL pattern",
      "Platform-specific payload formats",
      "SSRF protection on webhook URLs",
    ],
    href: "/docs/webhooks",
  },
  {
    icon: Code2,
    title: "Developers",
    subtitle: "Contributing",
    description:
      "Local development workflow, scripts, lint/typecheck/test, PR conventions, and the Node version policy.",
    features: [
      "npm scripts reference",
      "Adding tables, checks, and routes",
      "Node 22 LTS, vitest 4",
    ],
    href: "/docs/developers",
  },
  {
    icon: Server,
    title: "Self-Hosting",
    subtitle: "Production deployment",
    description:
      "Run VulnRadar on your own infrastructure: docker-compose, backups, Stripe webhook setup, updates.",
    features: [
      "docker-compose with PostgreSQL + app",
      "Backups via pg_dump",
      "Update flow and migrations",
    ],
    href: "/docs/self-hosting",
  },
];

export default function DocsPage() {
  const { setActiveSection, setTocItems } = useDocsContext();
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setTocItems(tocItems);
    return () => setTocItems([]);
  }, [setTocItems]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );

    tocItems.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [setActiveSection]);

  const curlExample = `curl -X POST "${APP_URL}/api/v3/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "example.com", "probes": ["ssh:22", "smtp:587"]}'`;

  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsHero
        badge={`v${APP_VERSION}`}
        title={`${APP_NAME} Documentation`}
        description={`Complete guide to using ${APP_NAME} for web vulnerability scanning. Integrate the API, self-host the platform, or extend the engine.`}
        stats={[
          { value: TOTAL_CHECKS_LABEL, label: "Detection Checks" },
          { value: "12", label: "Categories" },
          { value: "6", label: "Service Probes" },
          { value: API_CURRENT_VERSION, label: "API Version" },
        ]}
      />

      <DocsSection id="features" title="Platform Features">
        <DocsFeatureGrid features={platformFeatures} />
      </DocsSection>

      <DocsSection id="quick-start" title="Quick Start">
        <p className="text-sm text-muted-foreground">
          First scan in under a minute.
        </p>

        <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
            <div className="min-w-0">
              <DocsSteps steps={quickStartSteps} />
            </div>

            <div className="relative min-w-0">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Example Request
              </div>
              <div className="relative w-full overflow-hidden rounded-xl border border-border/50">
                <pre className="bg-muted/50 p-3 sm:p-4 overflow-x-auto text-xs sm:text-sm font-mono whitespace-pre-wrap break-words">
                  <code>{curlExample}</code>
                </pre>
                <CopyButton
                  text={curlExample}
                  className="absolute top-2 right-2 sm:top-3 sm:right-3"
                />
              </div>
            </div>
          </div>
        </Card>
      </DocsSection>

      <DocsSection id="documentation" title="Documentation">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border/20 border border-border/20 rounded-lg overflow-hidden">
          {docSections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="bg-card/50 hover:bg-muted/30 transition-colors p-4 sm:p-5 flex flex-col gap-1"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-foreground">
                  {section.title}
                </span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {section.subtitle}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {section.description}
              </p>
            </Link>
          ))}
        </div>
      </DocsSection>

      <DocsSection id="support" title="Support">
        <Card className="p-4 sm:p-5 border-border/50 bg-card/50">
          <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-medium text-foreground mb-1">
                Need help?
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Reach out via the contact form or open an issue on GitHub.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 flex-shrink-0">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="text-xs sm:text-sm"
              >
                <Link href="/contact">Contact Support</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="text-xs sm:text-sm"
              >
                <a
                  href={`https://github.com/${APP_REPO}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-3 border-border/50 bg-card/30">
          <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-center sm:justify-between text-xs sm:text-sm text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 font-mono text-[10px] sm:text-xs">
              <span>
                <span className="text-foreground">App:</span> {APP_VERSION}
              </span>
              <span>
                <span className="text-foreground">Engine:</span>{" "}
                {ENGINE_VERSION}
              </span>
              <span>
                <span className="text-foreground">API:</span>{" "}
                {API_CURRENT_VERSION}
              </span>
            </div>
            <a
              href={`${APP_URL}/api/version`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-xs sm:text-sm whitespace-nowrap"
            >
              Check version status
            </a>
          </div>
        </Card>
      </DocsSection>
    </div>
  );
}
