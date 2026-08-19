import type { Metadata } from "next";
import { headers } from "next/headers";
import { Footer } from "@/components/scanner/footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingSampleFinding } from "@/components/landing/landing-sample-finding";
import { LandingHowItWorks } from "@/components/landing/landing-how-it-works";
import { LandingCategories } from "@/components/landing/landing-categories";
import { LandingFeatures } from "@/components/landing/landing-features";
import { LandingUseCases } from "@/components/landing/landing-use-cases";
import { LandingApiExample } from "@/components/landing/landing-api-example";
import { LandingOpenSource } from "@/components/landing/landing-open-source";
import { LandingFaq, type FaqItem } from "@/components/landing/landing-faq";
import { LandingCta } from "@/components/landing/landing-cta";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  FaqStructuredData,
  SoftwareStructuredData,
} from "@/components/seo/structured-data";
import {
  APP_NAME,
  BILLING_ENABLED,
  BILLING_HISTORY_RETENTION,
  BILLING_PLAN_LIMITS,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/constants";
import { getCategoryCounts } from "@/lib/scanner/registry";

export const metadata: Metadata = pageMetadata({
  title: "Scan Any Website for Security Issues",
  description: `Paste a URL and get a structured security report in under 3 seconds. ${TOTAL_CHECKS_LABEL} deterministic checks across headers, TLS, cookies, DNS, and secrets. Free tier, no agent to install.`,
  path: "/landing",
});

const FREE_SCANS = BILLING_PLAN_LIMITS.free;
const FREE_RETENTION = BILLING_HISTORY_RETENTION.free;

// Questions people actually type into search. Rendered on the page and marked
// up as an FAQPage from the same array, so the structured data can never
// describe content the visitor cannot see. The first item leads with a crisp,
// self-contained definition an answer engine can quote directly.
function buildFaq(checkCount: number, categoryCount: number): FaqItem[] {
  return [
    {
      question: `What is ${APP_NAME}?`,
      answer: `${APP_NAME} is an open-source web vulnerability scanner. You paste a URL and it runs ${checkCount.toLocaleString()} deterministic checks across ${categoryCount} categories from our servers: security headers, TLS and certificates, cookie flags, DNS and email records, exposed secrets, server misconfiguration, information disclosure, client-side and supply-chain risks, and the gaps common in AI-generated code. Every finding comes back with a severity, the response evidence behind it, and a concrete fix. It is GPL-3.0 licensed and can be self-hosted.`,
    },
    {
      question: `Is ${APP_NAME} open source?`,
      answer: `Yes. ${APP_NAME} is licensed under GPL-3.0 and the entire detection engine is in the public repository, so you can read exactly what every check looks for and run the whole scanner yourself with no plan limits.`,
    },
    {
      question: "Is it free to use?",
      answer: BILLING_ENABLED
        ? `Yes. The free tier runs ${FREE_SCANS} scans a day with no card, and keeps results for ${FREE_RETENTION} days. Paid plans raise the daily limit and extend retention. The detection engine is identical on every plan.`
        : "Yes. Billing is disabled on this deployment, so every account has full access to the scanner and the API.",
    },
    {
      question: "Do I need to install anything?",
      answer:
        "No. Scans run from our servers against a URL you provide. There is no agent, no browser extension, and nothing to deploy alongside your application.",
    },
    {
      question: "How long does a scan take?",
      answer:
        "Under 3 seconds for a standard scan. Checks run in parallel, and the same URL produces the same finding IDs every time, so two runs can be diffed against each other.",
    },
    {
      question: "Can I self-host it?",
      answer:
        "Yes. The whole thing is GPL-3.0 and runs on your own infrastructure. The self-hosting guide covers deployment, the database, and configuration.",
    },
    {
      question: "What does the scanner actually check?",
      answer: `Security headers, TLS and certificate configuration, cookie flags, DNS and email records, exposed secrets, server misconfiguration, information disclosure, client-side risks, supply chain exposure, and the security gaps common in AI-generated code: ${categoryCount} categories in total.`,
    },
    {
      question: "Is there an API?",
      answer:
        "Yes. Everything the interface can do is available over REST with bearer token auth, plus webhooks for delivering results and scheduled scans for recurring checks.",
    },
  ];
}

export default async function LandingPage() {
  const nonce = (await headers()).get("x-nonce") ?? "";
  const counts = getCategoryCounts();
  const checkCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const categoryCount = Object.keys(counts).length;
  const faq = buildFaq(checkCount, categoryCount);

  return (
    <div className="min-h-screen flex flex-col bg-background overflow-x-hidden">
      <SoftwareStructuredData nonce={nonce} />
      <FaqStructuredData items={faq} nonce={nonce} />
      <LandingNav />
      <main className="flex-1 min-w-0">
        <LandingHero checkCount={checkCount} categoryCount={categoryCount} />
        <LandingSampleFinding />
        <LandingHowItWorks categoryCount={categoryCount} />
        <LandingFeatures />
        <LandingCategories />
        <LandingUseCases />
        <LandingApiExample checkCount={checkCount} />
        <LandingOpenSource />
        <LandingFaq items={faq} />
        <LandingCta freeScansPerDay={FREE_SCANS} />
      </main>
      <Footer />
    </div>
  );
}
