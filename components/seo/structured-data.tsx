import { EXACT_CHECK_CATEGORY_COUNT } from "@/lib/config/check-stats.generated";
import {
  APP_NAME,
  APP_REPO,
  APP_URL,
  APP_DESCRIPTION,
  APP_VERSION,
  SEO_TAGLINE,
  SEO_GITHUB_URL,
  SEO_LANGUAGE,
  SEO_ORG_FOUNDING_YEAR,
  SEO_LICENSE,
  SUPPORT_EMAIL,
  SOCIAL_PROFILE_URLS,
  TOTAL_CHECKS_LABEL,
  CHROME_WEB_STORE_URL,
  FIREFOX_ADDON_URL,
} from "@/lib/config/constants";

/**
 * JSON-LD structured data.
 *
 * Only types that still do something. Google retired FAQ rich results for
 * every site on 2026-05-07 and HowTo in 2023, and the sitelinks search box in
 * 2024, so FAQPage and HowTo blocks were six extra scripts on every check page
 * that earned nothing; the FAQs themselves are still on the page as text. What
 * is left: Organization (who publishes the site), WebSite (the site name, on
 * the home page only, where Google reads it), SoftwareApplication, breadcrumb
 * trails (desktop results) and TechArticle for reference pages.
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
const SOFTWARE_ID = `${APP_URL}/#software`;
const SOURCE_ID = `${APP_URL}/#source`;
const HOME_URL = `${APP_URL}/`;
/** Written by scripts/assets/build-icons.mjs from public/favicon.svg. */
const ORGANIZATION_LOGO = { url: `${APP_URL}/icon-512.png`, size: 512 };

/**
 * Organization, on every page, so the @id that TechArticle and
 * SoftwareApplication point at as their publisher always resolves on the page
 * that references it.
 */
export function OrganizationStructuredData({ nonce }: { nonce?: string }) {
  // sameAs links the entity to its verified profiles elsewhere, which is what
  // answer engines use to resolve "VulnRadar" to one thing. All real and
  // config-derived: the source repo, every configured social account
  // (SOCIAL_PROFILE_URLS, which includes the community Discord and already
  // excludes both the unconfigured platforms and the RSS feed, since a feed
  // is not an identity), and the two published extension store listings.
  // Store URLs are empty on a fork that has not published one, so
  // filter(Boolean) drops them cleanly. The Set guards against a deployment
  // pointing two of these at the same URL, which would publish a duplicate.
  const sameAs = [
    ...new Set(
      [
        // The GitHub organisation and the repository. Another project on
        // GitHub is also called VulnRadar, and search engines picked it as
        // ours; both URLs here, plus SourceCodeStructuredData on the home
        // page, state which one is.
        `https://github.com/${APP_REPO.split("/")[0]}`,
        SEO_GITHUB_URL,
        ...SOCIAL_PROFILE_URLS,
        CHROME_WEB_STORE_URL,
        FIREFOX_ADDON_URL,
      ].filter(Boolean),
    ),
  ];

  return (
    <JsonLd
      nonce={nonce}
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: APP_NAME,
        url: HOME_URL,
        // A raster logo at least 112px square is what Google accepts here.
        // This was /favicon.svg, a dark disc on a transparent square.
        logo: {
          "@type": "ImageObject",
          url: ORGANIZATION_LOGO.url,
          width: ORGANIZATION_LOGO.size,
          height: ORGANIZATION_LOGO.size,
        },
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
  );
}

/**
 * WebSite, on the home page only. This is where Google takes the site name
 * shown above a result, and its documentation is explicit that it reads the
 * markup from the home page and nowhere else. The alternate name is the bare
 * domain, which is the fallback Google itself suggests when it does not pick
 * the preferred name.
 */
export function WebSiteStructuredData({ nonce }: { nonce?: string }) {
  return (
    <JsonLd
      nonce={nonce}
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: APP_NAME,
        alternateName: [new URL(APP_URL).host],
        url: HOME_URL,
        description: APP_DESCRIPTION,
        publisher: { "@id": ORGANIZATION_ID },
        inLanguage: SEO_LANGUAGE,
      }}
    />
  );
}

interface SoftwareOffer {
  name: string;
  priceInCents: number;
}

/**
 * SoftwareApplication. Google's software rich result also needs a rating or a
 * review, and this site has neither and will not invent one, so this does not
 * earn the rich result on its own. It still states what the product is, that
 * it is free to use, and what each paid plan costs, which is what answer
 * engines read it for.
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
        "@id": SOFTWARE_ID,
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
          `${TOTAL_CHECKS_LABEL} security checks across ${EXACT_CHECK_CATEGORY_COUNT} categories`,
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
        // The free tier first: true on every deployment, billing or not
        // (with billing off, every account gets everything for nothing).
        offers: [{ name: "Free", priceInCents: 0 }, ...offers].map((o) => ({
          "@type": "Offer",
          name: o.name,
          price: (o.priceInCents / 100).toFixed(2),
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        })),
      }}
    />
  );
}

/**
 * SoftwareSourceCode, on the home page: the statement that this product's
 * source is that repository. Search engines matched "VulnRadar on GitHub" to
 * an unrelated project with the same name; a link alone says the two are
 * related, codeRepository plus targetProduct says what the relation is.
 */
export function SourceCodeStructuredData({ nonce }: { nonce?: string }) {
  return (
    <JsonLd
      nonce={nonce}
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        "@id": SOURCE_ID,
        name: APP_NAME,
        description: APP_DESCRIPTION,
        codeRepository: SEO_GITHUB_URL,
        url: SEO_GITHUB_URL,
        license: SEO_LICENSE,
        programmingLanguage: "TypeScript",
        runtimePlatform: "Node.js",
        author: { "@id": ORGANIZATION_ID },
        publisher: { "@id": ORGANIZATION_ID },
        targetProduct: { "@id": SOFTWARE_ID },
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
      }}
    />
  );
}
