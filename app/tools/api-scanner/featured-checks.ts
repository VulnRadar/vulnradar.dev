import { getCheckById, type SeoCheck } from "@/lib/seo/checks-content";

// Picked by hand, across categories, because the findings an API owner cares
// about are not all filed under "api": CORS lives in headers, and exposed
// GraphQL and Swagger documents in content. A slice of the category showed
// whatever happened to sit at the top of api.json.
export const FEATURED_API_CHECK_IDS = [
  "api-graphql-introspection-enabled",
  "graphql-introspection",
  "swagger-docs-exposed",
  "cors-origin-reflection",
  "cors-credentials-wildcard",
  "cors-null-origin-allowed",
  "rate-limiting",
  "api-openapi-no-security-declared",
] as const;

export function getFeaturedApiChecks(): SeoCheck[] {
  return FEATURED_API_CHECK_IDS.flatMap((id) => getCheckById(id) ?? []);
}
