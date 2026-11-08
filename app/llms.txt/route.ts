import {
  API,
  APP_NAME,
  APP_URL,
  APP_DESCRIPTION,
  SEO_TAGLINE,
  SEO_LICENSE,
  SEO_GITHUB_URL,
  DISCORD_INVITE_URL,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/constants";
import { EXACT_CHECK_CATEGORY_COUNT } from "@/lib/config/check-stats.generated";
import { DOCS_PAGES } from "@/components/docs/docs-nav";
import {
  SEO_CATEGORIES,
  getAllChecks,
  getCategorySeo,
  getSeoCategoryCounts,
} from "@/lib/seo/checks-content";
import { getAllAlternatives } from "@/lib/seo/alternatives";

// Served at /llms.txt. The llmstxt.org convention: a clean Markdown map of the
// site for LLMs and AI answer engines, so a model grounding an answer about
// this product reaches the canonical pages instead of guessing. Every link is
// derived from the same loaders the sitemap and the pages use
// (checks-content.ts, alternatives.ts), so it can never drift out of sync with
// what actually ships. Kept compact on purpose: it links to the checks index
// and the category pages rather than inlining every per-check URL, which live
// in the more detailed /llms-full.txt instead.
//
// Two numbers, kept apart because they answer different questions: the checks
// the engine runs (TOTAL_CHECKS_LABEL, the figure the whole site states) and
// the ones with a page of their own (getAllChecks), which is fewer.
export const dynamic = "force-static";

/** Collapse any whitespace so a description never breaks a Markdown line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function abs(path: string): string {
  return `${APP_URL}${path}`;
}

// Not exported: a Next.js route module may only export route handlers (GET,
// etc.) and route config, so this stays a local helper the GET below calls.
function buildLlmsTxt(): string {
  const fixGuides = getAllChecks().length;
  const counts = getSeoCategoryCounts();
  const alternatives = getAllAlternatives();

  const lines: string[] = [];

  lines.push(`# ${APP_NAME}`);
  lines.push("");
  lines.push(
    `> ${APP_NAME} is an open-source (${SEO_LICENSE}) ${SEO_TAGLINE.toLowerCase()}: paste a URL and it runs ${TOTAL_CHECKS_LABEL} deterministic checks across ${EXACT_CHECK_CATEGORY_COUNT} categories from its own servers, then returns a structured report with a severity, the response evidence, and a concrete fix for every finding.`,
  );
  lines.push("");
  lines.push(
    `${oneLine(APP_DESCRIPTION)} It runs as a hosted service with a free tier and can also be self-hosted with no plan limits. The detection engine is identical on every plan and its entire check set is public: ${fixGuides} with a fix guide of their own explaining the risk and how to fix it, the rest readable in the source repository.`,
  );
  lines.push("");
  lines.push(
    `Coverage spans security headers and Content-Security-Policy, TLS and certificate configuration, cookie and session flags, DNS and email authentication (SPF, DMARC, DKIM, DNSSEC), exposed secrets and API keys (AWS, Stripe, GitHub, OpenAI and more), server misconfiguration and information disclosure, client-side and DOM risks, software supply-chain exposure, and the security gaps common in AI-generated code. An opt-in active-probing mode goes beyond passive analysis to submit real payloads through discovered forms and parameters, confirming reflected cross-site scripting (XSS), error-based SQL injection, server-side template injection (SSTI), OS command injection, and open redirects. Active probing is off by default and only runs against targets the user explicitly authorizes.`,
  );
  lines.push("");

  // Documentation
  lines.push("## Documentation");
  lines.push("");
  for (const page of DOCS_PAGES) {
    lines.push(
      `- [${page.label}](${abs(page.href)})${page.summary ? `: ${oneLine(page.summary)}` : ""}`,
    );
  }
  lines.push(
    `- [OpenAPI document](${abs(API.OPENAPI)}): Machine-readable description of the REST API.`,
  );
  lines.push("");

  // Checks / fix guides
  lines.push("## Checks and fix guides");
  lines.push("");
  lines.push(
    `- [All checks](${abs("/checks")}): Browsable index of the ${fixGuides} checks with a fix guide, grouped by category.`,
  );
  for (const cat of SEO_CATEGORIES) {
    const seo = getCategorySeo(cat);
    lines.push(
      `- [${seo.heading}](${abs(`/checks/category/${cat}`)}): ${oneLine(seo.intro)} (${counts[cat]} with a fix guide)`,
    );
  }
  lines.push("");
  lines.push(
    `The per-check remediation guides are listed one by one in [llms-full.txt](${abs("/llms-full.txt")}).`,
  );
  lines.push("");

  // Free tools
  lines.push("## Free tools");
  lines.push("");
  const tools: [string, string, string][] = [
    [
      "/tools",
      "Free security tools",
      "No-signup, single-purpose views of the scanner.",
    ],
    [
      "/tools/api-scanner",
      "API scanner",
      "Check an API URL for CORS policy, rate-limit headers, GraphQL introspection, and exposed OpenAPI docs.",
    ],
    [
      "/tools/link-checker",
      "Link and redirect checker",
      "Follow a URL's redirect chain and inspect its headers, TLS, and reputation.",
    ],
  ];
  for (const [path, label, note] of tools) {
    lines.push(`- [${label}](${abs(path)}): ${note}`);
  }
  lines.push("");

  // Comparisons / alternatives
  lines.push("## Comparisons and alternatives");
  lines.push("");
  lines.push(
    `- [Alternatives overview](${abs("/alternatives")}): Honest, factual comparisons of ${APP_NAME} to the better-known commercial scanners.`,
  );
  for (const alt of alternatives) {
    lines.push(
      `- [${APP_NAME} vs ${alt.name}](${abs(`/alternatives/${alt.slug}`)}): ${APP_NAME} compared to ${alt.name} (${oneLine(alt.category)}).`,
    );
  }
  lines.push("");

  // Pricing
  lines.push("## Pricing");
  lines.push("");
  lines.push(
    `- [Pricing](${abs("/pricing")}): A free tier with no card, then paid plans that raise daily scan quotas and account limits such as API keys, webhooks and scheduled scans. The same detection engine runs on every plan.`,
  );
  lines.push("");

  // Product
  lines.push("## Product");
  lines.push("");
  const product: [string, string, string][] = [
    [
      "/",
      `What ${APP_NAME} is`,
      "Product overview, how a scan works, and the FAQ.",
    ],
    ["/demo", "Live demo", "Run a real scan without an account."],
    [
      "/changelog",
      "Changelog",
      "Release history for the app and the detection engine.",
    ],
  ];
  for (const [path, label, note] of product) {
    lines.push(`- [${label}](${abs(path)}): ${note}`);
  }
  lines.push("");

  // Off-site canonical links
  lines.push("## Links");
  lines.push("");
  lines.push(`- Source code: ${SEO_GITHUB_URL}`);
  if (DISCORD_INVITE_URL) lines.push(`- Community: ${DISCORD_INVITE_URL}`);
  lines.push("");

  return lines.join("\n");
}

export function GET(): Response {
  return new Response(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
}
