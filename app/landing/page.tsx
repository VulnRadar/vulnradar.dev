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
  description: `Paste a URL, get a security report in under 3 seconds: ${TOTAL_CHECKS_LABEL} deterministic checks across headers, TLS, cookies, DNS, and secrets. No agent to install.`,
  path: "/landing",
});

const FREE_SCANS = BILLING_PLAN_LIMITS.free;
const FREE_RETENTION = BILLING_HISTORY_RETENTION.free;
// Retention is stored as -1 for "unlimited" (see CONFIG_BILLING_*_RETENTION in
// lib/config/config-values.ts). Render that as words, never as the raw number:
// this FAQ shipped "keeps results for -1 days" to the live site. Same guard
// components/pricing/pricing-faq.tsx and app/pricing/page.tsx already apply.
const FREE_RETENTION_CLAUSE =
  FREE_RETENTION === -1
    ? "keeps every result, with no history limit"
    : `keeps results for ${FREE_RETENTION} days`;
// Only claim paid plans extend retention when retention is actually finite.
const PAID_RETENTION_CLAUSE =
  FREE_RETENTION === -1 ? "" : " and extend retention";

// Questions people actually type into search. Rendered on the page and marked
// up as an FAQPage from the same array, so the structured data can never
// describe content the visitor cannot see. The first item leads with a crisp,
// self-contained definition an answer engine can quote directly.
function buildFaq(checkCount: number, categoryCount: number): FaqItem[] {
  return [
    {
      question: `What is ${APP_NAME}?`,
      answer: `${APP_NAME} is an open-source web vulnerability scanner. You paste a URL and it runs ${checkCount.toLocaleString()} deterministic checks across ${categoryCount} categories from our servers: security headers, TLS and certificates, cookie flags, DNS and email records, exposed secrets, server misconfiguration, information disclosure, client-side and supply-chain risks, and the gaps common in AI-generated code. An opt-in active-probing mode additionally tests for SQL injection, cross-site scripting (XSS), template injection, and command injection. Every finding comes back with a severity, the response evidence behind it, and a concrete fix. It is GPL-3.0 licensed and can be self-hosted.`,
    },
    {
      question: `Is ${APP_NAME} open source?`,
      answer: `Yes. ${APP_NAME} is licensed under GPL-3.0 and the entire detection engine is in the public repository, so you can read exactly what every check looks for and run the whole scanner yourself with no plan limits.`,
    },
    {
      question: "Is it free to use?",
      answer: BILLING_ENABLED
        ? `Yes. The free tier runs ${FREE_SCANS} scans a day with no card, and ${FREE_RETENTION_CLAUSE}. Paid plans raise the daily limit${PAID_RETENTION_CLAUSE}. The detection engine is identical on every plan.`
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
      answer: `Security headers, TLS and certificate configuration, cookie flags, DNS and email records, exposed secrets, server misconfiguration, information disclosure, client-side risks, supply chain exposure, and the security gaps common in AI-generated code: ${categoryCount} categories in total. With active probing enabled it also submits real values through discovered forms to test for SQL injection, reflected XSS, server-side template injection, OS command injection, and open redirects.`,
    },
    {
      question: `Does ${APP_NAME} test for SQL injection and XSS?`,
      answer: `Yes. Alongside the passive checks, ${APP_NAME} has an opt-in active-probing mode that submits real payloads through the forms and parameters it discovers and confirms reflected cross-site scripting (XSS), error-based SQL injection, server-side template injection (SSTI), OS command injection, and open redirects. Active probing is off by default and only runs against targets you explicitly authorize, so a standard scan stays passive and safe.`,
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
      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0">
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
