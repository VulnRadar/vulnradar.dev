import { APP_NAME } from "@/lib/config/constants";

// Honest, factual comparison data for the /alternatives pages.
//
// Ground rules, because a comparison page that overreaches gets ignored (or
// worse, screenshotted):
//   - Only VulnRadar's own numbers are stated as fact (open-source GPL-3.0,
//     self-hostable, free tier, paid tiers derived from lib/billing/catalog).
//   - Competitor pricing is NEVER invented. Where a vendor publishes list
//     prices they change often and vary by region, so we describe the pricing
//     MODEL ("subscription, quote-based", "usage/asset-based") rather than a
//     dollar figure we would have to stand behind.
//   - Descriptions are neutral. We say what each tool is good at, then say
//     what VulnRadar does differently. No disparagement, no unverifiable
//     claims.
//   - An entry that cannot state real facts about the competitor does not
//     ship. The "intelliradar" entry was removed for exactly this: three of
//     its five rows read "Varies by product.", its summary described the
//     category rather than the product, and a page whose whole competitor
//     column is a shrug is a doorway page that drags down the four beside it
//     (AUDIT-014#seo-17). Deleting the entry also removes its sitemap entry,
//     its static param and its llms.txt line, since all three derive from
//     getAllAlternatives(). Higher-value additions, when someone has the
//     facts to hand: OWASP ZAP and Nuclei (the open-source self-hostable
//     comparisons) and Mozilla Observatory, Security Headers and SSL Labs
//     (the single-URL free scanners this product is genuinely searched
//     against).

export interface ComparisonRow {
  /** What is being compared, e.g. "Licensing". */
  feature: string;
  /** VulnRadar's answer. Factual, from our own product. */
  vulnradar: string;
  /** The competitor's answer. Neutral, model-level, never an invented price. */
  them: string;
}

export interface Alternative {
  /** URL slug: /alternatives/<slug>. */
  slug: string;
  /** Display name. */
  name: string;
  /** One-line category label. */
  category: string;
  /** Neutral one-paragraph description of the competitor. */
  summary: string;
  /** Where VulnRadar fits relative to them, honestly. */
  positioning: string;
  /** Side-by-side comparison rows. */
  rows: ComparisonRow[];
  /** Concrete things VulnRadar does differently. */
  differentiators: string[];
  /** FAQ, feeds FaqStructuredData. */
  faq: { question: string; answer: string }[];
}

// Shared VulnRadar-side answers so every table states the same facts.
const VR = {
  licensing: "Open source, GPL-3.0. Read the detection engine in the repo.",
  hosting: "Hosted SaaS or self-host it yourself with no plan limits.",
  pricing:
    "Free tier, then $5, $10, or $20 a month. Same engine on every tier.",
  onboarding: "Paste a URL. No agent, no appliance, no sales call.",
  engine: "One detection engine, identical on free and paid down to check IDs.",
  // Both of these ship today and neither was stated anywhere on the site:
  // lib/reports/sarif-report.ts emits SARIF 2.1.0 and
  // lib/reports/compliance-mappings.ts maps findings to six frameworks, and
  // GET /api/v3/history/[id]/report gates neither behind a plan.
  reports:
    "SARIF 2.1.0, PDF, Markdown, and a PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA and GDPR crosswalk. Included on the free tier.",
  ci: "SARIF straight into GitHub code scanning, plus webhooks and a REST API on every tier.",
  // Stated exactly as the code works, no further. lib/scanner/auth/types.ts is
  // the design note; app/api/v3/scan/authenticated/route.ts and
  // app/api/v3/scan/crawl/route.ts are the enforcement (login material is a
  // local in the handler, and the audit record they write names the origin,
  // the method and the outcome, never the material). There is no credential
  // table and no vault: an authenticated scan is re-supplied every time.
  credentials:
    "No credential store. A login is supplied with the scan request, held in memory for that one scan, and never written to a database, a log, or the saved result. The trade-off is real: with nothing saved, an authenticated scan is run on demand rather than on a schedule.",
};

/**
 * Reports row, added to every table. `them` stays model-level per the ground
 * rules at the top of this file: export formats and compliance views change
 * often enough that naming a competitor's current set would go stale.
 */
function reportsRow(them: string): ComparisonRow {
  return { feature: "Reports & compliance", vulnradar: VR.reports, them };
}

/**
 * Credential handling, added to every table. This is the row a prospect
 * evaluating authenticated scanning actually cares about ("do I have to give a
 * third party a working login to my staging environment"), and until now the
 * answer lived only in a source-file comment (AUDIT-014#comp-10).
 *
 * `them` stays model-level per the ground rules at the top of this file: every
 * one of these vendors configures authenticated scanning inside the product, so
 * a login of some form is held in the vendor's platform, but the specifics of
 * how each stores and protects it are theirs to state, not ours to characterize.
 */
function credentialsRow(them: string): ComparisonRow {
  return { feature: "Login credentials", vulnradar: VR.credentials, them };
}

const COMPETITORS: Alternative[] = [
  {
    slug: "detectify",
    name: "Detectify",
    category: "External attack surface management",
    summary:
      "Detectify is a commercial external attack surface management and web application scanning platform, known for crowdsourced vulnerability research feeding its detection and for continuous monitoring of large, changing asset inventories. It is aimed primarily at security teams managing many domains.",
    positioning: `Detectify is a strong fit for an established security team that wants continuous, managed EASM across a large estate. ${APP_NAME} is lighter and more developer-first: a fast single-URL or bulk scan you can run yourself, read the source of, and self-host, without an enterprise commitment.`,
    rows: [
      {
        feature: "Licensing",
        vulnradar: VR.licensing,
        them: "Commercial, closed source.",
      },
      {
        feature: "Hosting",
        vulnradar: VR.hosting,
        them: "Vendor-hosted SaaS.",
      },
      {
        feature: "Pricing model",
        vulnradar: VR.pricing,
        them: "Subscription, quote-based; see their site.",
      },
      {
        feature: "Best for",
        vulnradar: "Developers and small teams who want to scan and self-host.",
        them: "Teams managing large external attack surfaces.",
      },
      {
        feature: "Getting started",
        vulnradar: VR.onboarding,
        them: "Account setup and domain verification.",
      },
      credentialsRow(
        "Authenticated scanning is configured inside the product, so a login for your target is held vendor-side. See their documentation for how it is stored and protected.",
      ),
      reportsRow(
        "See the vendor for current export formats and compliance views.",
      ),
    ],
    differentiators: [
      "Open source and self-hostable, not a closed SaaS.",
      "Runs a full scan from a pasted URL in seconds, no asset onboarding first.",
      "Transparent, browsable check catalog with per-check fix guidance.",
      "Priced for individuals and small teams, not enterprise procurement.",
    ],
    faq: [
      {
        question: `Is ${APP_NAME} a cheaper Detectify alternative?`,
        answer: `${APP_NAME} is open source with a free tier and paid plans from $5 a month, so for an individual or small team it is dramatically cheaper than an enterprise EASM subscription. It targets a different job: fast, transparent scanning you can self-host, rather than managed attack-surface monitoring at scale.`,
      },
      {
        question: `Does ${APP_NAME} do continuous monitoring?`,
        answer:
          "It supports scheduled and bulk scans and webhook alerts, which covers recurring checks on the sites you care about. It is not a full EASM asset-discovery platform.",
      },
    ],
  },
  {
    slug: "intruder",
    name: "Intruder",
    category: "Continuous vulnerability scanner",
    summary:
      "Intruder (intruder.io) is a commercial continuous vulnerability management service that scans external and internal infrastructure and web apps, prioritises issues, and alerts on new exposures. It packages well-known scanning engines with a clean workflow aimed at teams without a dedicated security function.",
    positioning: `Intruder is a good hands-off managed scanner for infrastructure and network exposure. ${APP_NAME} focuses on the web and application layer of a target, is open source and self-hostable, and shows you exactly which checks run and how to fix each finding.`,
    rows: [
      {
        feature: "Licensing",
        vulnradar: VR.licensing,
        them: "Commercial, closed source.",
      },
      {
        feature: "Hosting",
        vulnradar: VR.hosting,
        them: "Vendor-hosted SaaS.",
      },
      {
        feature: "Pricing model",
        vulnradar: VR.pricing,
        them: "Subscription, per-target/asset tiers; see their site.",
      },
      {
        feature: "Focus",
        vulnradar: "Web and application-layer checks on a URL.",
        them: "Infrastructure, network, and web app scanning.",
      },
      {
        feature: "Getting started",
        vulnradar: VR.onboarding,
        them: "Account setup and target configuration.",
      },
      credentialsRow(
        "Authenticated scanning is configured inside the product, so a login for your target is held vendor-side. See their documentation for how it is stored and protected.",
      ),
      reportsRow(
        "See the vendor for current export formats and compliance views.",
      ),
    ],
    differentiators: [
      "Open source engine you can audit and self-host, not a managed black box.",
      "No per-target pricing: a plan's quota is scans per day, not assets under license.",
      "Every finding links to a page with the risk, fix steps, and framework-specific code.",
    ],
    faq: [
      {
        question: `Is ${APP_NAME} an open-source Intruder alternative?`,
        answer: `Yes. ${APP_NAME} is GPL-3.0, self-hostable, and free to start. It concentrates on web and application-layer checks rather than broad infrastructure scanning, and it does not charge per target.`,
      },
      {
        question: `Does ${APP_NAME} price per asset like Intruder?`,
        answer:
          "No. Plans are metered by scans per day, not by how many targets you have under license, and a self-hosted instance has no limit at all.",
      },
    ],
  },
  {
    // Kept on the /alternatives/probely slug so the URL, the sitemap entry
    // and the search term people actually type all still work, but the copy
    // no longer describes Probely in the present tense as an independent
    // vendor: it was acquired by Snyk in November 2024 and now sells as Snyk
    // API and Web. Saying otherwise is exactly the kind of staleness the
    // ground rules at the top of this file exist to prevent.
    slug: "probely",
    // `name` stays short: it is the H1, the comparison table's column header,
    // the breadcrumb and the keyword set. The acquisition goes in `category`,
    // the pill above the H1, and in the summary and FAQ below.
    name: "Probely",
    category: "Web & API scanner, now Snyk API and Web",
    summary:
      "Probely was a commercial web application and API vulnerability scanner built for developers and security teams, with a strong API, CI/CD integrations, and DAST coverage that maps findings to standards like OWASP. Snyk acquired it in November 2024 and it now sells as Snyk API and Web, so a search for Probely lands on Snyk's product line rather than a standalone one.",
    positioning: `Probely and ${APP_NAME} overlap on developer-first web and API scanning. Two differences matter now. Openness and cost: ${APP_NAME} is GPL-3.0 and self-hostable with a free tier, and publishes its full check catalog, while keeping a REST API and webhooks for the same CI use case. And continuity: the product you would be comparing against is inside a larger platform with its own tiering, whereas ${APP_NAME}'s engine is identical on every tier and readable in the repo.`,
    rows: [
      {
        feature: "Licensing",
        vulnradar: VR.licensing,
        them: "Commercial, closed source.",
      },
      {
        feature: "Hosting",
        vulnradar: VR.hosting,
        them: "Vendor-hosted SaaS.",
      },
      {
        feature: "Pricing model",
        vulnradar: VR.pricing,
        them: "Subscription, per-target tiers; see their site.",
      },
      {
        feature: "API & CI",
        vulnradar: VR.ci,
        them: "REST API and CI/CD integrations.",
      },
      {
        feature: "Getting started",
        vulnradar: VR.onboarding,
        them: "Account setup and target verification.",
      },
      credentialsRow(
        "Authenticated scanning is configured inside the product, so a login for your target is held vendor-side. See their documentation for how it is stored and protected.",
      ),
      reportsRow(
        "See the vendor for current export formats and compliance views.",
      ),
    ],
    differentiators: [
      "Open source and self-hostable, so scanning can stay entirely inside your own infrastructure.",
      "Free tier and $5-20/mo paid tiers instead of per-target enterprise pricing.",
      "The full check set is public, each with fix steps and copyable code.",
    ],
    faq: [
      {
        question: "Is Probely still available?",
        answer:
          "Not under that name as a standalone product. Snyk acquired Probely in November 2024 and it is now sold as Snyk API and Web, inside Snyk's platform and tiering. If you were comparing against Probely specifically, that is the product you are now comparing against.",
      },
      {
        question: `Is ${APP_NAME} a good Probely alternative for CI?`,
        answer: `Yes. ${APP_NAME} ships a REST API and webhooks on every tier, so you can trigger a scan and read findings from a pipeline the same way, and it exports SARIF straight into GitHub code scanning. It is also open source and self-hostable if you need scanning to run inside your own network.`,
      },
      {
        question: `Does ${APP_NAME} scan APIs?`,
        answer:
          "Yes. It has a dedicated API category covering CORS policy, rate-limit headers, GraphQL introspection, and exposed OpenAPI documents, and you can scan an API URL directly online.",
      },
    ],
  },
  {
    slug: "qualys",
    name: "Qualys",
    category: "Enterprise vulnerability management",
    summary:
      "Qualys is a long-established enterprise vulnerability management and compliance platform covering network, host, cloud, and web application scanning at very large scale, with agents, appliances, and deep compliance reporting. It is built for large organisations with dedicated security operations.",
    positioning: `Qualys is enterprise infrastructure: broad, deep, and heavy to operate. ${APP_NAME} is the opposite end of the spectrum on purpose: a fast, open-source, self-hostable web scanner you can run from a pasted URL, priced for individuals and small teams rather than enterprise contracts.`,
    rows: [
      {
        feature: "Licensing",
        vulnradar: VR.licensing,
        them: "Commercial, closed source.",
      },
      {
        feature: "Deployment",
        vulnradar: VR.onboarding,
        them: "Agents, appliances, and cloud connectors.",
      },
      {
        feature: "Pricing model",
        vulnradar: VR.pricing,
        them: "Enterprise subscription, quote-based; see their site.",
      },
      {
        feature: "Scope",
        vulnradar: "Web and application-layer checks on a URL.",
        them: "Network, host, cloud, and compliance at enterprise scale.",
      },
      {
        feature: "Best for",
        vulnradar: "Developers and small teams.",
        them: "Large enterprise security operations.",
      },
      credentialsRow(
        "Authenticated scanning is configured inside the platform, so a login for your target is held vendor-side. See their documentation for how it is stored and protected.",
      ),
      reportsRow(
        "Compliance reporting is a core product area at enterprise scale.",
      ),
    ],
    differentiators: [
      "No agents or appliances: a scan starts from a URL in the browser.",
      "Open source and self-hostable, with the engine readable in the repo.",
      "Small-team pricing instead of an enterprise contract.",
      "Every check is documented as a public page with a concrete fix.",
    ],
    faq: [
      {
        question: `Is ${APP_NAME} a lightweight Qualys alternative?`,
        answer: `For web and application-layer scanning, yes. ${APP_NAME} needs no agents or appliances, runs from a pasted URL, and is open source with a free tier. It does not try to replace Qualys for enterprise-wide network, host, and compliance management.`,
      },
      {
        question: `Can ${APP_NAME} run inside my own environment?`,
        answer:
          "Yes. It is GPL-3.0 and self-hostable, so you can run the scanner entirely on your own infrastructure with no plan limits.",
      },
    ],
  },
];

/**
 * Every vendor on these pages shipped an agentic AI pentest product in 2026,
 * priced far under a human engagement, so "why not just buy one of those" is
 * now a live objection on each of these comparisons and the site answered it
 * nowhere (AUDIT-014#comp-17). The position is deliberate rather than a gap:
 * an agentic pentest needs unattended exploitation of a live target, which
 * this product structurally refuses (active probes are opt-in and gated on
 * verified domain ownership), and a model in the detection path would cost
 * the reproducibility that makes the CI gate and the scan-to-scan diff mean
 * anything. Determinism only differentiates if you say what it is against,
 * so this is stated once and appended to every comparison page.
 */
const AGENTIC_PENTEST_FAQ = {
  question: `Does ${APP_NAME} do AI pentesting?`,
  answer: `No, on purpose. The detection engine is deterministic: the same URL produces the same finding IDs every run, which is what lets you fail a build on a specific ID and diff Tuesday's scan against Friday's. A model is used to triage and explain findings, never to decide whether one exists. Active probing, where ${APP_NAME} does send real payloads, is opt-in and only runs against domains you have proven you own. If you want an agent that autonomously exploits a live target and writes the report, that is a different product and this is not trying to be it.`,
};

const ALTERNATIVES: Alternative[] = COMPETITORS.map((alt) => ({
  ...alt,
  faq: [...alt.faq, AGENTIC_PENTEST_FAQ],
}));

const BY_SLUG = new Map(ALTERNATIVES.map((a) => [a.slug, a]));

export function getAlternative(slug: string): Alternative | undefined {
  return BY_SLUG.get(slug);
}

export function getAllAlternatives(): Alternative[] {
  return ALTERNATIVES;
}
