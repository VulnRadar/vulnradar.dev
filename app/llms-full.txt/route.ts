import {
  APP_NAME,
  APP_URL,
  SEO_TAGLINE,
  SEO_LICENSE,
  SEO_GITHUB_URL,
} from "@/lib/config/constants";
import {
  SEO_CATEGORIES,
  getAllChecks,
  getChecksInCategory,
  getCategoryLabel,
  getCategorySeo,
} from "@/lib/seo/checks-content";

// Served at /llms-full.txt. The detailed companion to /llms.txt: the same
// site map, but with every single check enumerated under its category and
// linked to its own remediation guide, so an AI answer engine grounding a
// "how do I fix X" answer can reach the exact page. Built from the same
// loaders (checks-content.ts) as the sitemap and the pages, so it stays in
// sync with what ships.
export const dynamic = "force-static";

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function abs(path: string): string {
  return `${APP_URL}${path}`;
}

function clamp(text: string, max = 160): string {
  const clean = oneLine(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}...`;
}

function buildLlmsFullTxt(): string {
  const total = getAllChecks().length;
  const categoryCount = SEO_CATEGORIES.length;

  const lines: string[] = [];

  lines.push(`# ${APP_NAME}: full check catalog`);
  lines.push("");
  lines.push(
    `> Every one of the ${total} security checks ${APP_NAME}, an open-source (${SEO_LICENSE}) ${SEO_TAGLINE.toLowerCase()}, runs against a URL, grouped into ${categoryCount} categories. Each entry links to a page explaining the risk and the exact fix.`,
  );
  lines.push("");
  lines.push(
    `This is the detailed companion to [/llms.txt](${abs("/llms.txt")}). Source: ${SEO_GITHUB_URL}`,
  );
  lines.push("");

  for (const cat of SEO_CATEGORIES) {
    const checks = getChecksInCategory(cat);
    if (checks.length === 0) continue;
    const seo = getCategorySeo(cat);
    lines.push(`## ${getCategoryLabel(cat)} (${checks.length} checks)`);
    lines.push("");
    lines.push(oneLine(seo.intro));
    lines.push("");
    for (const check of checks) {
      lines.push(
        `- [How to fix: ${check.title}](${abs(`/checks/${check.id}`)}): ${check.severity} severity. ${clamp(check.description)}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function GET(): Response {
  return new Response(buildLlmsFullTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
}
