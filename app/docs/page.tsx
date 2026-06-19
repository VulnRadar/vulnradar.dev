"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Shield,
  Globe,
  Clock,
  Key,
  Layers,
  FileCode,
  Zap,
  Code2,
  Terminal,
  BookOpen,
  ArrowRight,
  CheckCircle,
} from "lucide-react";
import {
  APP_NAME,
  APP_URL,
  APP_VERSION,
  ENGINE_VERSION,
  TOTAL_CHECKS_LABEL,
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
    icon: Shield,
    title: TOTAL_CHECKS_LABEL,
    description: "Comprehensive vulnerability detection engine",
  },
  {
    icon: Globe,
    title: "Multi-Protocol Support",
    description: "HTTP, HTTPS, WebSocket, FTP scanning",
  },
  {
    icon: Clock,
    title: "Real-Time Results",
    description: "Instant scan results with detailed findings",
  },
  {
    icon: Key,
    title: "API Access",
    description: "RESTful API with Bearer token authentication",
  },
  {
    icon: Layers,
    title: "Deep Crawl Mode",
    description: "Scan entire sites with automatic link discovery",
  },
  {
    icon: FileCode,
    title: "Open Source",
    description: "MIT licensed - self-host with full control",
  },
];

const quickStartSteps: Step[] = [
  {
    step: 1,
    title: "Create Account",
    description: `Sign up at ${APP_URL.replace("https://", "")}`,
  },
  {
    step: 2,
    title: "Generate API Key",
    description: "Profile → API Keys → Generate New Key",
  },
  {
    step: 3,
    title: "Make Your First Scan",
    description: "POST to /api/v2/scan with your target URL",
  },
  {
    step: 4,
    title: "View Results",
    description: "Detailed findings with severity and remediation steps",
  },
];

const docSections = [
  {
    icon: Zap,
    title: "API Reference",
    subtitle: "v2 REST API",
    description:
      "Complete API documentation with authentication, endpoints, code examples in cURL, JavaScript, and Python.",
    features: [
      "Bearer token authentication",
      "Scan, history, and crawl endpoints",
      "Rate limiting (varies by plan)",
      "Detailed error handling",
    ],
    href: "/docs/api",
  },
  {
    icon: Code2,
    title: "Setup Guide",
    subtitle: "Self-hosting",
    description: `Step-by-step instructions for deploying ${APP_NAME} on your own infrastructure with PostgreSQL.`,
    features: [
      "Prerequisites and installation",
      "Database and email configuration",
      "Docker and Vercel deployment",
      "Migration and version checking",
    ],
    href: "/docs/setup",
  },
  {
    icon: Terminal,
    title: "Developer Guide",
    subtitle: "SDKs & Integration",
    description:
      "Build custom integrations, create SDKs, and access the Finding Types API for dynamic vulnerability data.",
    features: [
      "Finding Types endpoint",
      "SDK development patterns",
      "Official Python & TypeScript SDKs",
      "Community contributions",
    ],
    href: "/docs/developers",
  },
  {
    icon: BookOpen,
    title: "Changelog",
    subtitle: "Version History",
    description: `Track all updates, new features, bug fixes, and improvements across ${APP_NAME} versions.`,
    features: [
      "Release notes and migration guides",
      "Breaking changes highlighted",
      "Feature announcements",
      "Security advisories",
    ],
    href: "/changelog",
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

  const curlExample = `curl -X POST "${APP_URL}/api/v2/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com"}'`;

  return (
    <div className="space-y-12 sm:space-y-16">
      {/* Hero Section */}
      <DocsHero
        badge={`v${APP_VERSION}`}
        title={`${APP_NAME} Documentation`}
        description={`Complete guide to using ${APP_NAME} for web vulnerability scanning. Learn how to integrate our API, self-host the platform, and build custom security workflows.`}
        stats={[
          { value: TOTAL_CHECKS_LABEL, label: "Security Checks" },
          { value: "v2", label: "API Version" },
          { value: "6", label: "Protocols" },
          { value: "MIT", label: "License" },
        ]}
      />

      {/* Key Features */}
      <DocsSection id="features" title="Platform Features">
        <DocsFeatureGrid features={platformFeatures} />
      </DocsSection>

      {/* Quick Start */}
      <DocsSection id="quick-start" title="Quick Start">
        <p className="text-sm text-muted-foreground">
          Get scanning in under 2 minutes.
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

      {/* Documentation Navigation */}
      <DocsSection id="documentation" title="Documentation">
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
          {docSections.map((section) => (
            <Card
              key={section.href}
              className="p-3 sm:p-5 border-border/50 bg-card/50 hover:border-primary/30 transition-colors group flex flex-col"
            >
              <div className="flex items-start gap-2 sm:gap-3 mb-2 sm:mb-3 min-w-0">
                <div className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl bg-primary/10 flex-shrink-0">
                  <section.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-medium text-foreground line-clamp-2">
                    {section.title}
                  </h3>
                  <p className="text-[10px] sm:text-xs text-muted-foreground line-clamp-1">
                    {section.subtitle}
                  </p>
                </div>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mb-2 sm:mb-3 leading-relaxed line-clamp-2 flex-1">
                {section.description}
              </p>
              <ul className="text-[10px] sm:text-xs text-muted-foreground space-y-1 mb-3 sm:mb-4">
                {section.features.slice(0, 2).map((item, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-1.5 line-clamp-1"
                  >
                    <CheckCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-primary flex-shrink-0" />
                    <span className="line-clamp-1">{item}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="w-full text-xs sm:text-sm"
              >
                <Link
                  href={section.href}
                  className="flex items-center justify-center gap-1 sm:gap-2"
                >
                  View {section.title}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </Card>
          ))}
        </div>
      </DocsSection>

      {/* Support */}
      <DocsSection id="support" title="Support">
        <Card className="p-4 sm:p-5 border-border/50 bg-card/50">
          <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-medium text-foreground mb-1">
                Need Help?
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Have questions or need assistance? Reach out through our contact
                form or check the community resources.
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
                  href="https://github.com/VulnRadar/vulnradar.dev"
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
              <span className="line-clamp-1">
                <span className="text-foreground">App:</span> {APP_VERSION}
              </span>
              <span className="line-clamp-1">
                <span className="text-foreground">Engine:</span>{" "}
                {ENGINE_VERSION}
              </span>
              <span className="line-clamp-1">
                <span className="text-foreground">API:</span> v2
              </span>
            </div>
            <a
              href={`${APP_URL}/api/version`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-xs sm:text-sm whitespace-nowrap"
            >
              Check version status →
            </a>
          </div>
        </Card>
      </DocsSection>
    </div>
  );
}
