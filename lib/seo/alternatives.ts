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
  pricing: "Free tier, then $5, $10, or $20 a month. Same engine on every tier.",
  onboarding: "Paste a URL. No agent, no appliance, no sales call.",
  engine: "One detection engine, identical on free and paid down to check IDs.",
};

export const ALTERNATIVES: Alternative[] = [
  {
    slug: "intelliradar",
    name: "IntelliRadar",
    category: "Vulnerability scanning tool",
    summary:
      "IntelliRadar is a security scanning tool in the same broad space as VulnRadar: point it at a target and get back a list of findings. Products in this category differ mostly in what they inspect, how they price, and whether you can run them yourself.",
    positioning:
      "If you found VulnRadar while searching for IntelliRadar, the practical difference to check is openness and price. VulnRadar is open-source under GPL-3.0, runs as a hosted scan or a self-hosted instance you control, and publishes its entire check set as browsable pages so you can see exactly what it looks for before you run anything.",
    rows: [
      { feature: "Licensing", vulnradar: VR.licensing, them: "Check the vendor's site; openness varies by product." },
      { feature: "Self-hosting", vulnradar: VR.hosting, them: "Varies by product." },
      { feature: "Pricing model", vulnradar: VR.pricing, them: "See the vendor's current pricing." },
      { feature: "Getting started", vulnradar: VR.onboarding, them: "Varies by product." },
      { feature: "Check transparency", vulnradar: "Every check is a public page with fix steps and code.", them: "Varies by product." },
    ],
    differentiators: [
      "The whole engine is open source, so nothing about a finding is a black box.",
      "Run it hosted or self-host it with no daily scan ceiling.",
      "Every check the engine runs has a public page explaining the risk and the fix.",
    ],
    faq: [
      {
        question: "Is VulnRadar a free IntelliRadar alternative?",
        answer:
          "VulnRadar has a free tier that needs no card and is open source under GPL-3.0, so you can also self-host it at no cost. Paid tiers start at $5 a month and only raise scan quotas.",
      },
      {
        question: "Can I self-host VulnRadar?",
        answer:
          "Yes. The detection engine is in the public repo and a self-hosted instance has no plan limits at all.",
      },
    ],
  },
  {
    slug: "detectify",
    name: "Detectify",
    category: "External attack surface management",
    summary:
      "Detectify is a commercial external attack surface management and web application scanning platform, known for crowdsourced vulnerability research feeding its detection and for continuous monitoring of large, changing asset inventories. It is aimed primarily at security teams managing many domains.",
    positioning:
      "Detectify is a strong fit for an established security team that wants continuous, managed EASM across a large estate. VulnRadar is lighter and more developer-first: a fast single-URL or bulk scan you can run yourself, read the source of, and self-host, without an enterprise commitment.",
    rows: [
      { feature: "Licensing", vulnradar: VR.licensing, them: "Commercial, closed source." },
      { feature: "Hosting", vulnradar: VR.hosting, them: "Vendor-hosted SaaS." },
      { feature: "Pricing model", vulnradar: VR.pricing, them: "Subscription, quote-based; see their site." },
      { feature: "Best for", vulnradar: "Developers and small teams who want to scan and self-host.", them: "Teams managing large external attack surfaces." },
      { feature: "Getting started", vulnradar: VR.onboarding, them: "Account setup and domain verification." },
    ],
    differentiators: [
      "Open source and self-hostable, not a closed SaaS.",
      "Runs a full scan from a pasted URL in seconds, no asset onboarding first.",
      "Transparent, browsable check catalog with per-check fix guidance.",
      "Priced for individuals and small teams, not enterprise procurement.",
    ],
    faq: [
      {
        question: "Is VulnRadar a cheaper Detectify alternative?",
        answer:
          "VulnRadar is open source with a free tier and paid plans from $5 a month, so for an individual or small team it is dramatically cheaper than an enterprise EASM subscription. It targets a different job: fast, transparent scanning you can self-host, rather than managed attack-surface monitoring at scale.",
      },
      {
        question: "Does VulnRadar do continuous monitoring?",
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
    positioning:
      "Intruder is a good hands-off managed scanner for infrastructure and network exposure. VulnRadar focuses on the web and application layer of a target, is open source and self-hostable, and shows you exactly which checks run and how to fix each finding.",
    rows: [
      { feature: "Licensing", vulnradar: VR.licensing, them: "Commercial, closed source." },
      { feature: "Hosting", vulnradar: VR.hosting, them: "Vendor-hosted SaaS." },
      { feature: "Pricing model", vulnradar: VR.pricing, them: "Subscription, per-target/asset tiers; see their site." },
      { feature: "Focus", vulnradar: "Web and application-layer checks on a URL.", them: "Infrastructure, network, and web app scanning." },
      { feature: "Getting started", vulnradar: VR.onboarding, them: "Account setup and target configuration." },
    ],
    differentiators: [
      "Open source engine you can audit and self-host, not a managed black box.",
      "No per-target pricing: a plan's quota is scans per day, not assets under license.",
      "Every finding links to a page with the risk, fix steps, and framework-specific code.",
    ],
    faq: [
      {
        question: "Is VulnRadar an open-source Intruder alternative?",
        answer:
          "Yes. VulnRadar is GPL-3.0, self-hostable, and free to start. It concentrates on web and application-layer checks rather than broad infrastructure scanning, and it does not charge per target.",
      },
      {
        question: "Does VulnRadar price per asset like Intruder?",
        answer:
          "No. Plans are metered by scans per day, not by how many targets you have under license, and a self-hosted instance has no limit at all.",
      },
    ],
  },
  {
    slug: "probely",
    name: "Probely",
    category: "Web application & API scanner",
    summary:
      "Probely is a commercial web application and API vulnerability scanner built for developers and security teams, with a strong API, CI/CD integrations, and DAST coverage that maps findings to standards like OWASP. It is designed to slot scanning into a development pipeline.",
    positioning:
      "Probely and VulnRadar overlap on developer-first web and API scanning. The difference is openness and cost: VulnRadar is GPL-3.0 and self-hostable with a free tier, and publishes its full check catalog, while keeping a REST API and webhooks for the same CI use case.",
    rows: [
      { feature: "Licensing", vulnradar: VR.licensing, them: "Commercial, closed source." },
      { feature: "Hosting", vulnradar: VR.hosting, them: "Vendor-hosted SaaS." },
      { feature: "Pricing model", vulnradar: VR.pricing, them: "Subscription, per-target tiers; see their site." },
      { feature: "API & CI", vulnradar: "REST API, webhooks, and CI-friendly scans on every tier.", them: "REST API and CI/CD integrations." },
      { feature: "Getting started", vulnradar: VR.onboarding, them: "Account setup and target verification." },
    ],
    differentiators: [
      "Open source and self-hostable, so scanning can stay entirely inside your own infrastructure.",
      "Free tier and $5-20/mo paid tiers instead of per-target enterprise pricing.",
      "The full check set is public, each with fix steps and copyable code.",
    ],
    faq: [
      {
        question: "Is VulnRadar a good Probely alternative for CI?",
        answer:
          "Yes. VulnRadar ships a REST API and webhooks on every tier, so you can trigger a scan and read findings from a pipeline the same way. It is also open source and self-hostable if you need scanning to run inside your own network.",
      },
      {
        question: "Does VulnRadar scan APIs?",
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
    positioning:
      "Qualys is enterprise infrastructure: broad, deep, and heavy to operate. VulnRadar is the opposite end of the spectrum on purpose: a fast, open-source, self-hostable web scanner you can run from a pasted URL, priced for individuals and small teams rather than enterprise contracts.",
    rows: [
      { feature: "Licensing", vulnradar: VR.licensing, them: "Commercial, closed source." },
      { feature: "Deployment", vulnradar: VR.onboarding, them: "Agents, appliances, and cloud connectors." },
      { feature: "Pricing model", vulnradar: VR.pricing, them: "Enterprise subscription, quote-based; see their site." },
      { feature: "Scope", vulnradar: "Web and application-layer checks on a URL.", them: "Network, host, cloud, and compliance at enterprise scale." },
      { feature: "Best for", vulnradar: "Developers and small teams.", them: "Large enterprise security operations." },
    ],
    differentiators: [
      "No agents or appliances: a scan starts from a URL in the browser.",
      "Open source and self-hostable, with the engine readable in the repo.",
      "Small-team pricing instead of an enterprise contract.",
      "Every check is documented as a public page with a concrete fix.",
    ],
    faq: [
      {
        question: "Is VulnRadar a lightweight Qualys alternative?",
        answer:
          "For web and application-layer scanning, yes. VulnRadar needs no agents or appliances, runs from a pasted URL, and is open source with a free tier. It does not try to replace Qualys for enterprise-wide network, host, and compliance management.",
      },
      {
        question: "Can VulnRadar run inside my own environment?",
        answer:
          "Yes. It is GPL-3.0 and self-hostable, so you can run the scanner entirely on your own infrastructure with no plan limits.",
      },
    ],
  },
];

const BY_SLUG = new Map(ALTERNATIVES.map((a) => [a.slug, a]));

export function getAlternative(slug: string): Alternative | undefined {
  return BY_SLUG.get(slug);
}

export function getAllAlternatives(): Alternative[] {
  return ALTERNATIVES;
}
