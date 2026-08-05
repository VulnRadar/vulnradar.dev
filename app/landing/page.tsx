import type { Metadata } from "next";
import { Footer } from "@/components/scanner/footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingStats } from "@/components/landing/landing-stats";
import { LandingSampleFinding } from "@/components/landing/landing-sample-finding";
import { LandingHowItWorks } from "@/components/landing/landing-how-it-works";
import { LandingCategories } from "@/components/landing/landing-categories";
import { LandingFeatures } from "@/components/landing/landing-features";
import { LandingUseCases } from "@/components/landing/landing-use-cases";
import { LandingApiExample } from "@/components/landing/landing-api-example";
import { LandingOpenSource } from "@/components/landing/landing-open-source";
import { LandingCta } from "@/components/landing/landing-cta";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  FaqStructuredData,
  SoftwareStructuredData,
} from "@/components/seo/structured-data";
import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants";

export const metadata: Metadata = pageMetadata({
  title: "Scan Any Website for Security Issues",
  description: `Paste a URL and get a structured security report in under 3 seconds. ${TOTAL_CHECKS_LABEL} deterministic checks across headers, TLS, cookies, DNS, and secrets. Free tier, no agent to install.`,
  path: "/landing",
});

// Questions people actually type into search. Marked up as an FAQPage so the
// answers can appear as an expandable block in results rather than a plain
// blue link.
const FAQ = [
  {
    question: "Is VulnRadar free to use?",
    answer:
      "Yes. The free tier allows 25 scans per day with no card required, and results are kept for 30 days. Paid plans raise the daily limit and extend retention. Every plan runs the same detection engine.",
  },
  {
    question: "Do I need to install anything to scan a site?",
    answer:
      "No. Scans run from our servers against a URL you provide, so there is no agent, no browser extension requirement, and nothing to deploy alongside your application.",
  },
  {
    question: "How long does a scan take?",
    answer:
      "A standard scan finishes in under 3 seconds. Checks run in parallel, and the same URL produces the same finding IDs each time, so results can be diffed between runs.",
  },
  {
    question: "Can I self-host VulnRadar?",
    answer:
      "Yes. VulnRadar is open source under GPL-3.0 and can be run on your own infrastructure. The self-hosting guide covers deployment, database setup, and configuration.",
  },
  {
    question: "What does the scanner check for?",
    answer:
      "Security headers, TLS and certificate configuration, cookie flags, DNS and email records, exposed secrets and credentials, server misconfiguration, information disclosure, client-side risks, supply chain exposure, and common AI-generated code antipatterns.",
  },
  {
    question: "Is there an API?",
    answer:
      "Yes. Every scan available in the interface is available over a REST API with token authentication, plus webhooks for delivering results to your own systems and scheduled scans for recurring checks.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background overflow-x-hidden">
      <SoftwareStructuredData />
      <FaqStructuredData items={FAQ} />
      <LandingNav />
      <main className="flex-1 min-w-0">
        <LandingHero />
        <LandingStats />
        <LandingSampleFinding />
        <LandingHowItWorks />
        <LandingCategories />
        <LandingFeatures />
        <LandingUseCases />
        <LandingApiExample />
        <LandingOpenSource />
        <LandingCta />
      </main>
      <Footer />
    </div>
  );
}
