// Check ids that v3.9.1 defined and this release does not.
//
// Most were retired because no scan reports them any more (5a22b2e4: a
// duplicate of another check, a header browsers dropped, a key that is public
// by design); the rest had no implementation (a34d9d11) or were folded into
// another check. 49 of them are pages the live site still serves and Google
// has indexed; the other five were "disabled duplicate" ids v3.9.1 already
// kept out of the sitemap, listed so an old link to one still lands. Each
// answers a 301 rather than a 404: to the check that covers the same finding
// where there is one, otherwise to its category page.
//
// middleware.ts reads this. tests/lib/seo/retired-checks.test.ts fails if a
// target stops resolving or a retired id comes back as a live check.
export const RETIRED_CHECK_REDIRECTS: Readonly<Record<string, string>> = {
  "age-header-reveals-cdn": "/checks/category/headers",
  "cf-ray-header": "/checks/category/headers",
  "code-auth-localstorage-tokens": "/checks/category/code",
  "code-cookie-write-no-secure": "/checks/category/code",
  "code-fetch-without-credentials": "/checks/category/code",
  "code-timing-no-constant-time-compare": "/checks/code-timing-hmac-equality",
  "console-log-production": "/checks/category/code",
  "cookie-domain-set-too-loose": "/checks/cookie-domain-broad",
  "cookie-host-prefix-injection-subdomain": "/checks/category/cookies",
  "cookie-max-age-zero": "/checks/category/cookies",
  "cookie-no-samesite-third-party": "/checks/category/cookies",
  "cookie-partitioned-missing": "/checks/category/cookies",
  "cookie-path-cross-app": "/checks/category/cookies",
  "cookie-prefix-invalid": "/checks/category/cookies",
  "cookie-security": "/checks/category/cookies",
  "cookie-third-party-no-samesite-none-secure": "/checks/category/cookies",
  "corp-missing": "/checks/cross-origin-resource-policy-report-only-missing",
  "credential-management-api": "/checks/category/code",
  "crypto-subtle-usage": "/checks/category/code",
  "csp-frame-ancestors": "/checks/clickjack-missing",
  "dns-resolves": "/checks/category/dns",
  "email-dmarc-ruf-missing": "/checks/category/email",
  "email-mta-sts-id-not-rotated": "/checks/category/email",
  "etag-inode-leak": "/checks/etag-inode",
  "eval-usage": "/checks/eval-in-scripts",
  "excessive-permissions": "/checks/category/headers",
  "expect-ct-missing": "/checks/category/ssl",
  "form-no-action-https": "/checks/form-action-http",
  "frame-busting-header-only": "/checks/category/headers",
  "ga-tracking-id-leaked": "/checks/category/information-disclosure",
  "nel-header-missing": "/checks/category/headers",
  "origin-agent-cluster-missing": "/checks/category/headers",
  "payment-request-api": "/checks/category/code",
  "postmessage-origin": "/checks/postmessage-no-origin-check",
  "privacy-policy-missing": "/checks/category/information-disclosure",
  "push-api-usage": "/checks/category/code",
  "recaptcha-key-leaked": "/checks/category/information-disclosure",
  "referrer-policy-missing": "/checks/category/headers",
  "server-timing-sensitive-key-leak": "/checks/server-timing-exposure",
  "session-cookie-flags": "/checks/category/cookies",
  "settimeout-string": "/checks/code-eval-setinterval-string",
  "sitemap-missing": "/checks/category/information-disclosure",
  "terms-of-service-missing": "/checks/category/information-disclosure",
  "vary-header-missing-user-agent": "/checks/category/configuration",
  "wasm-usage": "/checks/category/code",
  "weak-csp-directives": "/checks/category/headers",
  "webauthn-usage": "/checks/category/code",
  "x-amz-request-id": "/checks/category/headers",
  "x-cache-header": "/checks/category/headers",
  "x-content-type-options-not-nosniff": "/checks/nosniff-incorrect",
  "x-request-id-exposed": "/checks/category/headers",
  "x-vercel-id": "/checks/category/headers",
  "x-xss-protection-disabled": "/checks/x-xss-protection-block",
  "xxss-protection-missing": "/checks/x-xss-protection-block",
};
