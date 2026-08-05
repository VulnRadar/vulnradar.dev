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

function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
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
export function SiteStructuredData() {
  const sameAs = [SEO_GITHUB_URL, DISCORD_INVITE_URL].filter(Boolean);

  return (
    <>
      <JsonLd
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
}: {
  offers?: SoftwareOffer[];
}) {
  return (
    <JsonLd
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
          `${TOTAL_CHECKS_LABEL} security checks`,
          "Security header analysis",
          "TLS and certificate inspection",
          "Cookie and session flag auditing",
          "DNS and email record validation",
          "Secret and credential detection",
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
}: {
  items: { name: string; path: string }[];
}) {
  return (
    <JsonLd
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
}: {
  items: { question: string; answer: string }[];
}) {
  return (
    <JsonLd
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
 * TechArticle, for documentation pages. Signals to search engines that the
 * page is reference material rather than marketing copy.
 */
export function TechArticleStructuredData({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  return (
    <JsonLd
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
