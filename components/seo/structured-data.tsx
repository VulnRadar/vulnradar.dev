import {
  APP_NAME,
  APP_URL,
  APP_DESCRIPTION,
  APP_VERSION,
  LOGO_URL,
  SEO_TAGLINE,
  SEO_GITHUB_URL,
  SEO_LANGUAGE,
  SEO_ORG_FOUNDING_YEAR,
  SEO_LICENSE,
  SUPPORT_EMAIL,
  DISCORD_INVITE_URL,
  TOTAL_CHECKS_LABEL,
  CHROME_WEB_STORE_URL,
  FIREFOX_ADDON_URL,
} from "@/lib/config/constants";

/**
 * JSON-LD structured data.
 *
 * Search engines use this to build rich results: the sitelinks search box,
 * the software panel with rating and price, breadcrumb trails, and FAQ
 * accordions in the results page. Plain HTML gives them none of that.
 *
 * Everything is derived from lib/config so a self-hosted deployment does not
 * publish our name, repo, or contact details.
 */

/**
 * Escapes the characters that let a JSON string terminate the surrounding
 * <script> block. `JSON.stringify` leaves `<` intact, so a value containing
 * `</script>` would close the tag early and inject markup into the page.
 *
 * Today every value here comes from lib/config rather than user input, so
 * this is defence in depth. It stays because the cost is one replace and the
 * failure mode if a future caller passes through user data is stored XSS.
 */
function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function JsonLd({
  data,
  nonce,
}: {
  data: Record<string, unknown>;
  nonce?: string;
}) {
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}

const ORGANIZATION_ID = `${APP_URL}/#organization`;
const WEBSITE_ID = `${APP_URL}/#website`;

/**
 * Organization plus WebSite. Belongs on every page: the @id references let
 * the other blocks point at these instead of repeating them.
 */
export function SiteStructuredData({ nonce }: { nonce?: string }) {
  // sameAs links the entity to its verified profiles elsewhere, which is what
  // answer engines use to resolve "VulnRadar" to one thing. All real and
  // config-derived: the source repo, the community server, and the two
  // published extension store listings. Store URLs are empty on a fork that
  // has not published one, so filter(Boolean) drops them cleanly.
  const sameAs = [
    SEO_GITHUB_URL,
    DISCORD_INVITE_URL,
    CHROME_WEB_STORE_URL,
    FIREFOX_ADDON_URL,
  ].filter(Boolean);

  return (
    <>
      <JsonLd
        nonce={nonce}
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          "@id": ORGANIZATION_ID,
          name: APP_NAME,
          url: APP_URL,
          logo: LOGO_URL,
          description: APP_DESCRIPTION,
          foundingDate: SEO_ORG_FOUNDING_YEAR,
          ...(sameAs.length ? { sameAs } : {}),
          contactPoint: {
            "@type": "ContactPoint",
            email: SUPPORT_EMAIL,
            contactType: "customer support",
            availableLanguage: SEO_LANGUAGE,
          },
        }}
      />
      <JsonLd
        nonce={nonce}
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          "@id": WEBSITE_ID,
          name: APP_NAME,
          url: APP_URL,
          description: APP_DESCRIPTION,
          publisher: { "@id": ORGANIZATION_ID },
          inLanguage: SEO_LANGUAGE,
        }}
      />
    </>
  );
}

interface SoftwareOffer {
  name: string;
  priceInCents: number;
}

/**
 * SoftwareApplication. Drives the software rich result, which shows price and
 * category directly in search listings.
 */
export function SoftwareStructuredData({
  offers = [],
  nonce,
}: {
  offers?: SoftwareOffer[];
  nonce?: string;
}) {
  return (
    <JsonLd
      nonce={nonce}
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: APP_NAME,
        applicationCategory: "SecurityApplication",
        applicationSubCategory: SEO_TAGLINE,
        operatingSystem: "Any",
        url: APP_URL,
        description: APP_DESCRIPTION,
        softwareVersion: APP_VERSION,
        license: SEO_LICENSE,
        isAccessibleForFree: true,
        publisher: { "@id": ORGANIZATION_ID },
        featureList: [
          `${TOTAL_CHECKS_LABEL} security checks across 18 categories`,
          "Active injection testing: SQL injection, reflected XSS, SSTI, OS command injection, open redirect",
          "Security header, CSP and cookie analysis",
          "TLS and certificate inspection",
          "DNS and email record validation (SPF, DMARC, DKIM, DNSSEC)",
          "Exposed secret detection (AWS, Stripe, GitHub, OpenAI keys)",
          "Supply-chain and client-side risk detection",
          "AI-generated code vulnerability checks",
          "Scheduled and bulk scanning",
          "REST API and webhooks",
        ],
        ...(offers.length
          ? {
              offers: offers.map((o) => ({
                "@type": "Offer",
                name: o.name,
                price: (o.priceInCents / 100).toFixed(2),
                priceCurrency: "USD",
                availability: "https://schema.org/InStock",
              })),
            }
          : {}),
      }}
    />
  );
}

/**
 * BreadcrumbList. Replaces the raw URL in a search result with a readable
 * trail, which measurably improves click-through on deep pages.
 */
export function BreadcrumbStructuredData({
  items,
  nonce,
}: {
  items: { name: string; path: string }[];
  nonce?: string;
}) {
  return (
    <JsonLd
      nonce={nonce}
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: item.name,
          item: `${APP_URL}${item.path}`,
        })),
      }}
    />
  );
}

/**
 * FAQPage. Eligible for an expandable answer block in search results, which
 * takes up far more vertical space than a standard listing.
 */
export function FaqStructuredData({
  items,
  nonce,
}: {
  items: { question: string; answer: string }[];
  nonce?: string;
}) {
  return (
    <JsonLd
      nonce={nonce}
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      }}
    />
  );
}

/**
 * HowTo. The per-check fix guides are literally ordered remediation steps, so
 * marking them up as a HowTo lets generative engines lift the exact sequence
 * to answer a "how do I fix X" question. Only render this where the page
 * actually shows those steps, so the structured data never claims a procedure
 * the reader cannot see (which Google also penalises).
 */
export function HowToStructuredData({
  name,
  description,
  steps,
  path,
  nonce,
}: {
  name: string;
  description: string;
  steps: string[];
  path: string;
  nonce?: string;
}) {
  return (
    <JsonLd
      nonce={nonce}
      data={{
        "@context": "https://schema.org",
        "@type": "HowTo",
        name,
        description,
        url: `${APP_URL}${path}`,
        inLanguage: SEO_LANGUAGE,
        step: steps.map((text, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          text,
        })),
      }}
    />
  );
}

/**
 * TechArticle, for documentation pages. Signals to search engines that the
 * page is reference material rather than marketing copy.
 */
export function TechArticleStructuredData({
  title,
  description,
  path,
  nonce,
}: {
  title: string;
  description: string;
  path: string;
  nonce?: string;
}) {
  return (
    <JsonLd
      nonce={nonce}
      data={{
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: title,
        description,
        url: `${APP_URL}${path}`,
        inLanguage: SEO_LANGUAGE,
        author: { "@id": ORGANIZATION_ID },
        publisher: { "@id": ORGANIZATION_ID },
        isPartOf: { "@id": WEBSITE_ID },
      }}
    />
  );
}
