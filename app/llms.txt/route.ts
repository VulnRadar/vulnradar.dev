import {
  APP_NAME,
  APP_URL,
  APP_DESCRIPTION,
  SEO_TAGLINE,
  SEO_LICENSE,
  SEO_GITHUB_URL,
  DISCORD_INVITE_URL,
} from "@/lib/config/constants";
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
// and the 18 category pages rather than inlining all 754 per-check URLs, which
// live in the more detailed /llms-full.txt instead.
export const dynamic = "force-static";

/** Collapse any whitespace so a description never breaks a Markdown line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function abs(path: string): string {
  return `${APP_URL}${path}`;
}

export function buildLlmsTxt(): string {
  const checks = getAllChecks();
  const total = checks.length;
  const counts = getSeoCategoryCounts();
  const categoryCount = SEO_CATEGORIES.length;
  const alternatives = getAllAlternatives();

  const lines: string[] = [];

  lines.push(`# ${APP_NAME}`);
  lines.push("");
  lines.push(
    `> ${APP_NAME} is an open-source (${SEO_LICENSE}) ${SEO_TAGLINE.toLowerCase()}: paste a URL and it runs ${total} deterministic checks across ${categoryCount} categories from its own servers, then returns a structured report with a severity, the response evidence, and a concrete fix for every finding.`,
  );
  lines.push("");
  lines.push(
    `${oneLine(APP_DESCRIPTION)} It runs as a hosted service with a free tier and can also be self-hosted with no plan limits. The detection engine is identical on every plan and its entire check set is public, each check documented as its own page explaining the risk and how to fix it.`,
  );
  lines.push("");

  // Documentation
  lines.push("## Documentation");
  lines.push("");
  const docs: [string, string, string][] = [
    ["/docs", "Documentation", "Setup, usage, and reference for the scanner and the API."],
    ["/docs/api", "API reference", "REST API with bearer-token auth to trigger scans and read results."],
    ["/docs/setup", "Setup guide", "Getting an account, first scan, and API keys."],
    ["/docs/self-hosting", "Self-hosting guide", "Run the whole scanner on your own infrastructure under GPL-3.0."],
    ["/docs/extension", "Browser extension", "Scan the page you are currently viewing from the browser."],
    ["/docs/webhooks", "Webhooks", "Deliver scan results to your own endpoints."],
    ["/docs/rate-limits", "Rate limits", "API request and scan quotas per plan."],
    ["/docs/config", "Configuration", "Environment and config values for a self-hosted deployment."],
  ];
  for (const [path, label, note] of docs) {
    lines.push(`- [${label}](${abs(path)}): ${note}`);
  }
  lines.push("");

  // Checks / fix guides
  lines.push("## Checks and fix guides");
  lines.push("");
  lines.push(
    `- [All checks](${abs("/checks")}): Browsable index of every one of the ${total} checks, grouped into ${categoryCount} categories, each linking to its own fix guide.`,
  );
  for (const cat of SEO_CATEGORIES) {
    const seo = getCategorySeo(cat);
    lines.push(
      `- [${seo.heading}](${abs(`/checks/category/${cat}`)}): ${oneLine(seo.intro)} (${counts[cat]} checks)`,
    );
  }
  lines.push("");
  lines.push(
    `A per-check remediation guide for every single check is listed in [llms-full.txt](${abs("/llms-full.txt")}).`,
  );
  lines.push("");

  // Free tools
  lines.push("## Free tools");
  lines.push("");
  const tools: [string, string, string][] = [
    ["/tools", "Free security tools", "No-signup, single-purpose views of the scanner."],
    ["/tools/api-scanner", "API scanner", "Check an API URL for CORS policy, rate-limit headers, GraphQL introspection, and exposed OpenAPI docs."],
    ["/tools/link-checker", "Link and redirect checker", "Follow a URL's redirect chain and inspect its headers, TLS, and reputation."],
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
    `- [Pricing](${abs("/pricing")}): A free tier with no card, then paid plans that only raise daily scan quotas and history retention. The same detection engine runs on every plan.`,
  );
  lines.push("");

  // Product
  lines.push("## Product");
  lines.push("");
  const product: [string, string, string][] = [
    ["/landing", `What ${APP_NAME} is`, "Product overview, how a scan works, and the FAQ."],
    ["/demo", "Live demo", "Run a real scan without an account."],
    ["/public-scans", "Public scans directory", "Recently shared public scan reports."],
    ["/changelog", "Changelog", "Release history for the app and the detection engine."],
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
