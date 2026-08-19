import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config/constants";
import { DISALLOWED_PATHS } from "@/lib/seo/routes";

// Served at /robots.txt.
export const dynamic = "force-static";

/**
 * The answer-engine and generative-engine crawlers we explicitly want reading
 * the public content: search-grounding fetchers (an AI cites us when it
 * answers a question), training crawlers (Google-Extended, Applebot-Extended,
 * CCBot control AI-training use), and the on-demand user-triggered fetchers
 * (ChatGPT-User, Perplexity-User) that pull a page when someone asks about us.
 * Allowing them opts this site INTO being quoted by ChatGPT, Claude,
 * Perplexity, Google AI Overviews, Gemini, Apple, and the rest. They get the
 * whole public surface (Allow: /) and are still fenced out of the same
 * authenticated and tokenised paths everyone else is via DISALLOWED_PATHS.
 */
const AI_CRAWLERS = [
  // OpenAI / ChatGPT
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  // Anthropic / Claude
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Google (Gemini / AI Overviews training + the classic crawler)
  "Google-Extended",
  "Googlebot",
  // Apple Intelligence
  "Applebot-Extended",
  // Common Crawl (feeds many model training sets)
  "CCBot",
  // Others
  "cohere-ai",
  "Bytespider",
  "Amazonbot",
  "Meta-ExternalAgent",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...DISALLOWED_PATHS],
      },
      {
        // Explicitly allow the AI answer/generative engines onto the full
        // public surface (not the narrow hand-picked list this used to carry,
        // which left the 754 per-check fix guides and llms.txt out of reach
        // for them). Same private/tokenised paths stay disallowed.
        userAgent: AI_CRAWLERS,
        allow: "/",
        disallow: [...DISALLOWED_PATHS],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
