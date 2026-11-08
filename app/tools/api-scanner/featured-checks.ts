import { getCheckById, type SeoCheck } from "@/lib/seo/checks-content";

// Picked by hand, across categories, because the findings an API owner cares
// about are not all filed under "api": CORS lives in headers, and exposed
// Swagger documents in content. A slice of the category showed whatever
// happened to sit at the top of api.json. No two share a dedupe group: the
// engine would report them as one finding, which wastes a slot.
export const FEATURED_API_CHECK_IDS = [
  "api-graphql-introspection-enabled",
  "swagger-docs-exposed",
  "cors-origin-reflection",
  "cors-credentials-wildcard",
  "cors-null-origin-allowed",
  "rate-limiting",
  "api-openapi-no-security-declared",
  "api-bearer-header-leak",
] as const;

export function getFeaturedApiChecks(): SeoCheck[] {
  return FEATURED_API_CHECK_IDS.flatMap((id) => getCheckById(id) ?? []);
}
