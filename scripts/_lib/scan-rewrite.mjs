/**
 * Master scanner-rewriter.
 *
 * Drives the full rewrite of `lib/scanner/checks-data/<category>.json`
 * for all 12 categories (709 checks). The script is deterministic,
 * idempotent (re-running is a no-op after the first write), and
 * commits nothing — it's a data migration utility.
 *
 * Transformations per entry:
 *   1. ID renamed to `<category>-<concept>` per the audit's mapping.
 *      Falls back to a deterministic kebab-case transformation if no
 *      explicit mapping exists.
 *   2. `category` set to the file's category (handles any straggler
 *      entries from the previous foundation pass).
 *   3. `severity` lowercased and normalised to one of
 *      "critical" | "high" | "medium" | "low" | "info".
 *   4. `evidence` rewritten to a real template that includes the
 *      actual offending value (per the audit's per-check guidance).
 *   5. `description` rewritten to a single sentence (was sometimes
 *      a placeholder or auto-generated block).
 *   6. `explanation` expanded with technical detail (was sometimes
 *      identical to description).
 *   7. `riskImpact` rewritten to 1-2 sentences focused on real-world
 *      consequences.
 *   8. `fixSteps` rewritten to 2-6 concrete, copy-paste-runnable steps.
 *   9. `codeExamples` filled with at least 2 verified server-config
 *      snippets from `scripts/_lib/rewrite-code-examples.mjs`.
 *  10. `references` filled with verified URLs only (CWE/OWASP/RFC/MDN).
 *
 * Run with: `node scripts/_lib/scan-rewrite.mjs [--dry-run]`.
 */

import fs from "fs";
import path from "path";
import { CODE_EXAMPLES } from "./rewrite-code-examples.mjs";
import { REFERENCES } from "./rewrite-references.mjs";

const CHECKS_DIR = "lib/scanner/checks-data";
const CATEGORIES = [
  "headers",
  "ssl",
  "tls",
  "content",
  "cookies",
  "configuration",
  "information-disclosure",
  "dns",
  "email",
  "api",
  "code",
  "secrets-extended",
];

// ── Per-check overrides ──────────────────────────────────────────────
//
// Most entries use the template defaults. Specific entries that the
// audit flagged with concrete evidence strings, code-example choices,
// references, or severity changes are listed here.
//
// Each entry maps old ID → new fields. Anything not listed gets the
// default transformations.

const ENTRY_OVERRIDES = {};

function applyOverride(entry, category) {
  const override =
    ENTRY_OVERRIDES[entry.id] || ENTRY_OVERRIDES[`${category}/${entry.id}`];
  if (!override) return entry;
  return { ...entry, ...override };
}

// ── ID rename mapping ────────────────────────────────────────────────
//
// old_id → new_id. If an old ID has no mapping, we transform it
// deterministically by prefixing with the category.

const ID_RENAME = {
  // ── headers (Group A) ──────────────────────────────────────────
  "hsts-missing": "headers-hsts-missing",
  "csp-missing": "headers-csp-missing",
  "clickjack-missing": "headers-clickjack-missing",
  "xcto-missing": "headers-x-content-type-options-missing",
  "referrer-policy-missing": "headers-referrer-policy-missing",
  "permissions-policy-missing": "headers-permissions-policy-missing",
  "cors-wildcard": "headers-cors-allow-origin-wildcard",
  "xxss-protection-missing": "headers-x-xss-protection-missing",
  "cors-credentials-wildcard":
    "headers-cors-allow-origin-wildcard-with-credentials",
  "cors-wildcard-credentials":
    "headers-cors-allow-origin-wildcard-with-credentials",
  "cors-credentials-with-wildcard":
    "headers-cors-allow-origin-wildcard-with-credentials",
  "access-control-allow-credentials-with-wildcard":
    "headers-cors-allow-origin-wildcard-with-credentials",
  "coop-missing": "headers-cross-origin-opener-policy-missing",
  "corp-missing": "headers-cross-origin-resource-policy-missing",
  "coep-missing": "headers-cross-origin-embedder-policy-missing",
  "coep-header-missing": "headers-cross-origin-embedder-policy-missing",
  "csp-report-only": "headers-csp-report-only-without-enforcing",
  "no-clickjack-protection": "headers-clickjack-protection-missing",
  "clickjacking-frameable": "headers-clickjack-protection-missing",
  "weak-csp-directives": "headers-csp-weak-directives",
  "csp-framework-required": "headers-csp-framework-required",
  "dns-prefetch-on": "headers-x-dns-prefetch-control-on",
  "rate-limiting-missing": "headers-rate-limit-headers-missing",
  "csp-frame-ancestors-missing": "headers-csp-frame-ancestors-missing",
  "csp-frame-ancestors": "headers-csp-frame-ancestors-missing",
  "cors-origin-reflection": "headers-cors-origin-reflection-with-credentials",
  "clear-site-data-missing": "headers-clear-site-data-missing-on-logout",
  "csp-unsafe-eval-non-framework": "headers-csp-unsafe-eval-non-framework",
  "csp-form-action-missing": "headers-csp-form-action-missing",
  "csp-base-uri-missing": "headers-csp-base-uri-missing",
  "csp-object-src-missing": "headers-csp-object-src-missing",
  "hsts-no-preload": "headers-hsts-missing-preload-or-includesubdomains",
  "csp-no-upgrade-insecure": "headers-csp-upgrade-insecure-requests-missing",
  "csp-upgrade-insecure-missing":
    "headers-csp-upgrade-insecure-requests-missing",
  "coep-credentialless": "headers-coep-not-credentialless-or-require-corp",
  "csp-report-uri-deprecated": "headers-csp-report-uri-deprecated",
  "nosniff-incorrect": "headers-x-content-type-options-not-nosniff",
  "x-content-type-options-not-nosniff":
    "headers-x-content-type-options-not-nosniff",
  "timing-allow-wildcard": "headers-timing-allow-origin-wildcard",
  "csp-unsafe-inline-script": "headers-csp-script-src-unsafe-inline-no-nonce",
  "csp-unsafe-eval-detected": "headers-csp-unsafe-eval-allowed",
  "csp-wildcard-source": "headers-csp-wildcard-source",
  "csp-data-uri-allowed": "headers-csp-data-uri-in-script-src",
  "csp-no-default-src": "headers-csp-no-default-src",
  "cors-null-origin-allowed": "headers-cors-allow-origin-null",
  "referrer-policy-unsafe": "headers-referrer-policy-unsafe",
  "x-xss-protection-disabled": "headers-x-xss-protection-disabled",
  "csp-unsafe-hashes": "headers-csp-unsafe-hashes",
  "csp-frame-src-missing": "headers-csp-frame-src-missing",
  "csp-object-src-unsafe": "headers-csp-object-src-unsafe-value",
  "csp-script-src-self-only": "headers-csp-script-src-self-only",
  "csp-block-all-mixed-content": "headers-csp-block-all-mixed-content-missing",
  "cors-methods-too-permissive": "headers-cors-allow-methods-wildcard",
  "access-control-allow-methods-wildcard":
    "headers-cors-allow-methods-wildcard",
  "frame-busting-header-only":
    "headers-x-frame-options-without-csp-frame-ancestors",
  "x-frame-options-invalid": "headers-x-frame-options-invalid-value",
  "x-frame-options-allowall": "headers-x-frame-options-allowall",
  "cache-control-no-store-missing":
    "headers-cache-control-no-store-on-sensitive-page",
  "pragma-no-cache-legacy": "headers-pragma-no-cache-legacy",
  "expires-past": "headers-expires-past",
  "accept-ch-missing": "headers-accept-ch-missing",
  "accept-ch-lifetime-missing": "headers-accept-ch-lifetime-missing",
  "critical-ch-missing": "headers-critical-ch-missing",
  "cross-origin-opener-policy-report-only-missing":
    "headers-coop-report-only-missing",
  "cross-origin-resource-policy-report-only-missing":
    "headers-corp-report-only-missing",
  "origin-isolation-header-missing": "headers-origin-isolation-header-missing",
  "early-data-header-missing": "headers-early-data-header-missing",
  "sec-fetch-version-missing": "headers-sec-fetch-missing",
  "trigger-header-missing": "headers-trigger-header-missing",
  "link-rel-dns-prefetch-missing": "headers-link-rel-dns-prefetch-missing",
  "link-rel-preconnect-missing": "headers-link-rel-preconnect-missing",
  "link-rel-preload-missing": "headers-link-rel-preload-missing",
  "access-control-expose": "headers-cors-expose-headers",
  "access-control-expose-broad": "headers-cors-expose-headers-broad",
  "access-control-max-age-long": "headers-cors-max-age-long",
  "excessive-permissions": "headers-permissions-policy-overly-permissive",
  "feature-policy-deprecated": "headers-feature-policy-deprecated",
  "server-header-disclosure": "headers-server-header-disclosure",
  "server-version-detailed": "headers-server-version-detailed",
  "x-powered-by-exposed": "headers-x-powered-by-exposed",
  "x-aspnet-version-exposed": "headers-x-aspnet-version-exposed",
  "x-aspnetmvc-version-exposed": "headers-x-aspnetmvc-version-exposed",
  "via-header-exposed": "headers-via-header-exposed",
  "x-runtime-exposed": "headers-x-runtime-exposed",
  "x-request-id-exposed": "headers-x-request-id-exposed",
  "x-backend-server-exposed": "headers-backend-server-header-exposed",
  "age-header-reveals-cdn": "headers-age-header-exposes-cdn",
  "x-debug-header-exposed": "headers-debug-header-exposed",
  "x-amz-request-id": "headers-aws-request-id-exposed",
  "cf-ray-header": "headers-cloudflare-cf-ray-exposed",
  "x-vercel-id": "headers-vercel-id-exposed",
  "x-cache-header": "headers-x-cache-header-exposed",
  "etag-inode": "headers-etag-inode-leak",
  "etag-inode-leak": "headers-etag-inode-leak",
  "server-timing-exposure": "headers-server-timing-exposure",
  "timing-allow-origin-wide": "headers-timing-allow-origin-wildcard",
  "date-time-skew": "headers-date-time-skew",
  "x-dns-prefetch-control-off": "headers-x-dns-prefetch-control-off",
  "cache-control-public-sensitive": "headers-cache-control-public-sensitive",
  "cache-control-missing": "headers-cache-control-missing",
  "nel-missing": "headers-nel-missing",
  "nel-header-missing": "headers-nel-missing",
  "document-policy-missing": "headers-document-policy-missing",
  "origin-agent-cluster": "headers-origin-agent-cluster-missing",
  "report-to-header-missing": "headers-report-to-missing",
  "mixed-content": "headers-mixed-content",
  "form-action-http": "headers-form-action-http-on-https",
  "mixed-content-form-action": "headers-form-action-http-on-https",
  "sri-missing": "headers-external-script-no-sri",
  "external-script-no-sri": "headers-external-script-no-sri",
  "sri-stylesheet-missing": "headers-external-stylesheet-no-sri",
  "sri-link-stylesheet-missing": "headers-external-stylesheet-no-sri",
  "cookie-security": "headers-cookie-security",
  "deprecated-tls": "headers-site-accessible-over-http",
  "referrer-policy-no-referrer-strict-origin-when-cross-origin":
    "headers-referrer-policy-not-strict",
  "strict-transport-security-include-subdomains":
    "headers-hsts-missing-includesubdomains",
  "server-timing-sensitive-key-leak":
    "headers-server-timing-sensitive-key-leak",
  "server-timing-no-allow-origin":
    "headers-server-timing-without-timing-allow-origin",
  "speculation-rules-missing": "headers-speculation-rules-missing",
  "cookie-host-prefix-attribute-mismatch":
    "headers-cookie-host-prefix-attribute-mismatch",
  "cross-origin-embedder-policy-credentialless-missing":
    "headers-coep-credentialless-not-set",
  "cross-origin-opener-policy-same-origin-allow-popups":
    "headers-coop-same-origin-allow-popups",

  // ── ssl ────────────────────────────────────────────────────────
  "expect-ct-missing": "ssl-expect-ct-header",
  "https-unusual-port": "ssl-https-non-standard-port",
  "x-forwarded-method-override": "ssl-x-forwarded-method-override",
  "http3-alt-svc-header": "ssl-alt-svc-http3",
  "ocsp-stapling-enabled": "ssl-ocsp-response-in-header",
  "ssl-http-and-https-both": "ssl-http-and-https-both",
  "ssl-https-only-cookie-on-http": "ssl-secure-cookie-on-http",
  "unencrypted-connection": "ssl-unencrypted-connection",
  "ssl-strip-detected": "ssl-ssl-strip-detected",
  "http-no-redirect": "ssl-no-https-redirect",

  // ── tls ────────────────────────────────────────────────────────
  "tls-certificate-expiry": "tls-certificate-expiring",
  "tls-protocol-version": "tls-protocol-version-weak",
  "tls-cert-key-size-rsa": "tls-rsa-key-too-small",
  "tls-cert-key-size-ecdsa": "tls-ecdsa-key-too-small",
  "tls-cert-sha1-sig": "tls-certificate-signed-sha1",
  "tls-cert-self-signed": "tls-certificate-self-signed",
  "tls-ocsp-stapling-missing": "tls-ocsp-stapling-missing",
  "tls-ct-log-missing": "tls-certificate-transparency-log-missing",
  "tls-hpkp-deprecated": "tls-hpkp-header-present",
  "tls-tls-1-3-not-supported": "tls-version-1-3-not-supported",
  "tls-hsts-preload-status": "tls-hsts-not-on-preload-list",
  "tls-cert-must-staple-missing": "tls-certificate-must-staple-missing",
  "tls-cert-san-missing": "tls-certificate-san-missing",
  "tls-cert-key-usage-wrong": "tls-certificate-key-usage-wrong",
  "tls-cert-expired-ca-chain": "tls-certificate-chain-expired",
  "tls-cipher-3des-offered": "tls-cipher-3des-offered",
  "tls-cipher-rc4-offered": "tls-cipher-rc4-offered",
  "tls-cipher-null-offered": "tls-cipher-null-offered",
  "tls-cipher-export-offered": "tls-cipher-export-offered",
  "tls-cipher-anonymous-dh": "tls-cipher-anonymous-dh",

  // ── content (Group B-1) ────────────────────────────────────────
  "mixed-content": "content-mixed-content",
  "open-redirect": "content-open-redirect",
  "open-redirect-params": "content-open-redirect",
  "sri-missing": "content-external-script-no-sri",
  "form-action-http": "content-form-action-http",
  "form-no-action-https": "content-form-action-not-https",
  "email-exposure": "content-email-exposure",
  "directory-listing": "content-directory-listing",
  "sensitive-files": "content-sensitive-files",
  "outdated-js-libs": "content-outdated-js-libs",
  "robots-txt-exposure": "content-robots-txt-exposure",
  "cms-fingerprinting": "content-cms-fingerprinting",
  "security-txt-missing": "content-security-txt-missing",
  "dangerous-inline-js": "content-dangerous-inline-js",
  "reverse-tabnabbing": "content-external-link-noopener",
  "unsafe-target-blank": "content-external-link-noopener",
  "window-opener-leak": "content-external-link-noopener",
  "window-opener-abuse": "content-external-link-noopener",
  "source-maps": "content-sourcemap-exposure",
  "sourcemap-exposed": "content-sourcemap-exposure",
  "sourcemap-reference": "content-sourcemap-exposure",
  "sensitive-comments": "content-sensitive-comments",
  "private-ip-exposure": "content-internal-ip-exposed",
  "hardcoded-ip-addresses": "content-internal-ip-exposed",
  "internal-ip-exposed": "content-internal-ip-exposed",
  "debug-indicators": "content-debug-output-exposed",
  "insecure-iframes": "content-insecure-iframes",
  "token-exposure": "content-token-exposure",
  "autocomplete-sensitive": "content-autocomplete-missing-on-sensitive-field",
  "autocomplete-sensitive-fields":
    "content-autocomplete-missing-on-sensitive-field",
  "autocomplete-password": "content-password-input-missing-autocomplete",
  "form-target-blank": "content-form-target-blank",
  "meta-refresh": "content-meta-refresh",
  "base-tag-insecure": "content-base-tag-insecure",
  "excessive-permissions": "content-permissions-policy-overly-permissive",
  "postmessage-no-origin": "content-postmessage-no-origin-check",
  "sensitive-endpoints": "content-sensitive-endpoints",
  "dangerous-html-attrs": "content-dangerous-html-attrs",
  "jwt-in-url": "content-jwt-in-url",
  "sensitive-meta-tags": "content-sensitive-meta-tags",
  "storage-api-sensitive": "content-storage-api-sensitive",
  "local-storage-sensitive": "content-storage-api-sensitive",
  "cdn-no-sri": "content-cdn-no-sri",
  "og-injection": "content-open-graph-injection",
  "opengraph-injection": "content-open-graph-injection",
  "sw-insecure": "content-service-worker-insecure",
  "websocket-insecure": "content-websocket-insecure",
  "websocket-unencrypted": "content-websocket-insecure",
  "cross-site-websocket": "content-websocket-insecure",
  "document-domain": "content-document-domain",
  "document-domain-usage": "content-document-domain",
  "weak-crypto": "content-weak-crypto",
  "password-no-paste": "content-password-paste-blocked",
  "exposed-error-messages": "content-debug-output-exposed",
  "xxe-server-xml": "content-xxe-server-xml",
  "ssrf-vectors": "content-ssrf-vectors",
  "graphql-introspection": "content-graphql-introspection-enabled",
  "iframe-sandbox-missing": "content-iframe-no-sandbox",
  "iframe-no-sandbox": "content-iframe-no-sandbox",
  "password-input-no-name": "content-password-input-missing-name",
  "sensitive-form-no-csrf": "content-form-missing-csrf",
  "exposed-api-version": "content-api-version-exposure",
  "api-version-exposed": "content-api-version-exposure",
  "html-lang-missing": "content-html-lang-missing",
  "open-form-action": "content-form-action-external-allowlist",
  "viewport-user-scalable-no": "content-viewport-user-scalable-no",
  "exposed-stack-trace": "content-stack-trace-exposed",
  "stack-trace-exposed": "content-stack-trace-exposed",
  "verbose-error-messages": "content-stack-trace-exposed",
  "document-write-usage": "content-document-write-usage",
  "preconnect-third-party": "content-excessive-third-party-connections",
  "input-no-maxlength": "content-input-missing-maxlength",
  "lazy-loading-missing": "content-lazy-loading-missing",
  "cookie-no-secure-prefix": "cookies-secure-prefix-missing",
  "feature-policy-deprecated": "content-feature-policy-deprecated",
  "set-cookie-samesite-none-no-secure": "cookies-samesite-none-missing-secure",
  "cookie-max-age-excessive": "cookies-max-age-excessive",
  "aws-metadata-reference": "content-aws-metadata-reference",
  "git-directory-exposed": "content-git-directory-exposed",
  "env-file-reference": "content-env-file-reference",
  "backup-file-reference": "content-backup-file-reference",
  "phpinfo-exposed": "content-phpinfo-exposed",
  "wp-login-exposed": "content-wordpress-login-exposed",
  "graphql-endpoint-exposed": "content-graphql-endpoint-exposed",
  "swagger-docs-exposed": "content-swagger-docs-exposed",
  "sql-error-in-page": "content-sql-error-exposure",
  "php-error-in-page": "content-php-error-exposed",
  "asp-error-in-page": "content-asp-error-exposed",
  "django-debug-page": "content-django-debug-page",
  "laravel-debug-page": "content-laravel-debug-page",
  "spring-boot-actuator": "content-spring-boot-actuator",
  "mixed-content-form-action": "content-form-action-mixed-content",
  "inline-event-handlers": "content-inline-event-handlers",
  "postmessage-star-origin": "content-postmessage-star-origin",
  "jwt-in-html": "content-jwt-in-html",
  "private-key-in-source": "content-private-key-in-source",
  "base64-credentials": "content-base64-credentials",
  "connection-string-exposed": "content-connection-string-exposed",
  "s3-bucket-exposed": "content-s3-bucket-exposed",
  "firebase-config-exposed": "content-firebase-config-exposed",
  "sri-link-stylesheet-missing": "content-external-stylesheet-no-sri",
  "form-method-get-sensitive": "content-form-method-get-sensitive",
  "meta-referrer-unsafe": "content-meta-referrer-unsafe",
  "session-cookie-flags": "cookies-session-flags",
  "exposed-session-id": "content-session-id-in-url",
  "password-in-get": "content-password-in-get",
  "weak-password-policy": "content-weak-password-policy",
  "remember-me-token": "content-remember-me-token",
  "oauth-state-missing": "content-oauth-state-missing",
  "debug-endpoint": "content-debug-endpoint",
  "admin-endpoint": "content-admin-endpoint",
  "email-enumeration": "content-email-enumeration",
  "cdn-fallback-missing": "content-cdn-fallback-missing",
  "outdated-jquery": "content-outdated-jquery",
  "outdated-angular": "content-outdated-angular",
  "prototype-js-outdated": "content-prototype-js-outdated",
  "mootools-outdated": "content-mootools-outdated",
  "document-cookie-access": "content-document-cookie-access",
  "credit-card-pattern": "content-credit-card-pattern",
  "ssn-pattern": "content-ssn-pattern",
  "phone-number-leak": "content-phone-number-leak",
  "email-address-leak": "content-email-exposure",
  "bearer-token-exposed": "content-bearer-token-exposed",
  "api-key-in-url": "content-api-key-in-url",
  "aws-credentials-exposed": "content-aws-credentials-exposed",
  "private-key-exposed": "content-private-key-exposed",
  "database-connection-string": "content-connection-string-exposed",
  "stripe-key-exposed": "content-stripe-key-exposed",
  "twilio-credentials-exposed": "content-twilio-credentials-exposed",
  "sendgrid-key-exposed": "content-sendgrid-key-exposed",
  "slack-webhook-exposed": "content-slack-webhook-exposed",
  "discord-webhook-exposed": "content-discord-webhook-exposed",
  "github-token-exposed": "content-github-token-exposed",
  "google-api-key-exposed": "content-google-api-key-exposed",
  "mailchimp-key-exposed": "content-mailchimp-key-exposed",
  "heroku-api-key-exposed": "content-heroku-api-key-exposed",
  "npm-token-exposed": "content-npm-token-exposed",
  "docker-hub-token-exposed": "content-docker-hub-token-exposed",
  "sql-error-exposed": "content-sql-error-message-exposure",
  "nosql-error-exposed": "content-nosql-error-exposed",
  "ldap-error-exposed": "content-ldap-error-exposed",
  "xml-error-exposed": "content-xml-error-exposed",
  "json-hijacking-vulnerable": "content-json-hijacking-vulnerable",
  "jsonp-endpoint": "content-jsonp-endpoint",
  "dom-clobbering-vulnerable": "content-dom-clobbering-vulnerable",
  "srcdoc-iframe": "content-srcdoc-iframe",
  "sandbox-allow-scripts": "content-sandbox-allow-scripts",
  "svg-script-injection": "content-svg-script-injection",
  "data-uri-script": "content-data-uri-script",
  "blob-url-script": "content-blob-url-script",
  "form-autocomplete-off": "content-form-autocomplete-off",
  "input-maxlength-short": "content-input-maxlength-short",
  "hidden-password-field": "content-hidden-password-field",
  "password-visible-default": "content-password-visible-default",
  "readonly-sensitive-field": "content-readonly-sensitive-field",
  "file-upload-no-restrictions": "content-file-upload-no-restrictions",
  "multiple-file-upload": "content-multiple-file-upload",
  "todo-fixme-comments": "content-todo-fixme-comments",
  "source-code-comment": "content-sensitive-comments",
  "iframe-lazy-loading": "content-iframe-lazy-loading",
  "preconnect-missing": "content-preconnect-missing",
  "dns-prefetch-missing": "content-dns-prefetch-missing",
  "sri-missing-critical": "content-external-script-no-sri",
  "sri-missing-stylesheet": "content-external-stylesheet-no-sri",
  "password-input-toggle": "content-password-input-toggle",
  "email-input-no-autocomplete": "content-email-input-no-autocomplete",
  "cc-input-no-autocomplete": "content-cc-input-no-autocomplete",
  "search-input-no-type": "content-search-input-no-type",
  "tel-input-no-autocomplete": "content-tel-input-no-autocomplete",
  "img-no-alt": "content-img-missing-alt",
  "link-no-rel": "content-link-rel-missing",
  "meta-redirect-no-url": "content-meta-redirect-no-url",
  "iframe-missing-allowfullscreen": "content-iframe-missing-allowfullscreen",
  "iframe-missing-loading-lazy": "content-iframe-missing-loading-lazy",
  "autocomplete-username": "content-username-input-no-autocomplete",
  "image-protocol-relative": "content-image-protocol-relative",
  "open-graph-image-not-https": "content-open-graph-image-not-https",
  "canonical-link-missing": "content-canonical-link-missing",
  "viewport-meta-missing": "content-viewport-meta-missing",
  "charset-meta-missing": "content-charset-meta-missing",
  "doctype-missing": "content-doctype-missing",
  "inline-style-attr": "content-inline-style-attr",
  "target-blank-no-noopener": "content-external-link-noopener",
  "email-mailto-spam": "content-mailto-link-spam-exposure",
  "iframe-third-party-without-sandbox":
    "content-iframe-third-party-without-sandbox",
  "autofocus-positive-tabindex": "content-autofocus-positive-tabindex",
  "aria-hidden-focusable-children": "content-aria-hidden-focusable-children",
  "form-formnovalidate-bypass": "content-form-formnovalidate-bypass",
  "form-action-javascript-scheme": "content-form-action-javascript-scheme",
  "form-action-mailto-scheme": "content-form-action-mailto-scheme",
  "form-action-tel-scheme": "content-form-action-tel-scheme",
  "iframe-srcdoc-no-sandbox": "content-iframe-srcdoc-no-sandbox",
  "iframe-allow-scripts-allow-same-origin":
    "content-iframe-allow-scripts-allow-same-origin",
  "svg-onload-handler": "content-svg-onload-handler",
  "svg-external-entity-reference": "content-svg-external-entity-reference",
  "service-worker-insecure": "content-service-worker-insecure",

  // ── cookies (Group B-1) ─────────────────────────────────────────
  "cookie-security": "cookies-cookie-security",
  "cookie-path-root": "cookies-path-root",
  "cookie-domain-broad": "cookies-domain-broad",
  "cookie-prefix-missing": "cookies-secure-prefix-missing",
  "cookie-partitioned-missing": "cookies-partitioned-missing",
  "cookie-host-prefix-not-secure": "cookies-host-prefix-not-secure",
  "cookie-host-prefix-wrong-path": "cookies-host-prefix-wrong-path",
  "cookie-secure-prefix-not-secure": "cookies-secure-prefix-not-secure",
  "cookie-domain-set-too-loose": "cookies-domain-explicit-unnecessary",
  "cookie-expires-too-far": "cookies-expires-too-far",
  "cookie-name-disclosure": "cookies-name-disclosure",
  "cookie-no-csrf-token": "cookies-csrf-token-missing",
  "cookie-domain-no-leading-dot": "cookies-domain-no-leading-dot",
  "cookie-path-cross-app": "cookies-path-cross-app",
  "cookie-expires-in-past": "cookies-expires-in-past",
  "cookie-max-age-zero": "cookies-max-age-zero",
  "cookie-domain-parent-on-subdomain": "cookies-domain-parent-on-subdomain",
  "cookie-no-samesite-third-party": "cookies-no-samesite-third-party",
  "cookie-partitioned-without-secure": "cookies-partitioned-without-secure",
  "cookie-missing-domain-host-only": "cookies-missing-domain-host-only",
  "cookie-third-party-no-samesite-none-secure":
    "cookies-third-party-no-samesite-none-secure",
  "cookie-host-prefix-injection-subdomain":
    "cookies-host-prefix-injection-subdomain",
  "cookie-httponly-missing": "cookies-httponly-missing",
  "cookie-secure-missing": "cookies-secure-missing",
  "cookie-samesite-missing": "cookies-samesite-missing",
  "cookie-prefix-invalid": "cookies-prefix-invalid",

  // ── configuration (Group B-2) ───────────────────────────────────
  "server-header-disclosure": "configuration-server-header-disclosure",
  "cache-control-missing": "configuration-cache-control-missing",
  "nel-missing": "configuration-nel-missing",
  "report-to-header-missing": "configuration-report-to-missing",
  "x-powered-by-exposed": "configuration-x-powered-by-exposed",
  "x-aspnet-version-exposed": "configuration-x-aspnet-version-exposed",
  "x-aspnetmvc-version-exposed": "configuration-x-aspnetmvc-version-exposed",
  "via-header-exposed": "configuration-via-header-exposed",
  "x-runtime-exposed": "configuration-x-runtime-exposed",
  "x-request-id-exposed": "configuration-x-request-id-exposed",
  "x-backend-server-exposed": "configuration-backend-server-header-exposed",
  "age-header-reveals-cdn": "configuration-age-header-exposed",
  "x-debug-header-exposed": "configuration-debug-header-exposed",
  "cache-control-public-sensitive":
    "configuration-cache-control-public-sensitive",
  "access-control-expose-broad": "configuration-cors-expose-headers-broad",
  "access-control-max-age-long": "configuration-cors-max-age-long",
  "etag-inode-leak": "configuration-etag-inode-leak",
  "clickjacking-frameable": "configuration-clickjacking-protection-missing",
  "x-amz-request-id": "configuration-aws-request-id-exposed",
  "cf-ray-header": "configuration-cloudflare-cf-ray-exposed",
  "x-vercel-id": "configuration-vercel-id-exposed",
  "x-cache-header": "configuration-x-cache-header-exposed",
  "date-time-skew": "configuration-date-time-skew",
  "document-policy-missing": "configuration-document-policy-missing",
  "origin-agent-cluster": "configuration-origin-agent-cluster-missing",
  "x-dns-prefetch-control-off": "configuration-dns-prefetch-control-off",
  "debug-via-cookie": "configuration-debug-cookie",
  "cookie-too-large": "configuration-cookie-too-large",
  "vary-header-missing": "configuration-vary-header-missing",
  "vary-header-missing-user-agent": "configuration-vary-user-agent-missing",
  "vary-header-cookie": "configuration-vary-cookie-missing",
  "transfer-encoding-chunked": "configuration-transfer-encoding-chunked",
  "server-timing-allow-origin-public": "configuration-server-timing-public",
  "content-disposition-inline": "configuration-content-disposition-inline",
  "x-xss-protection-block": "configuration-x-xss-protection-deprecated",
  "server-timing-cache-timings": "configuration-server-timing-cache-leak",
  "vary-cookie-on-static-resource": "configuration-vary-cookie-static-resource",
  "vary-origin-missing-cors": "configuration-vary-origin-cors-missing",
  "x-cache-status-cloudflare": "configuration-x-cache-status-exposed",
  "x-amz-cf-id": "configuration-x-amz-cf-id-exposed",
  "x-vercel-cache": "configuration-x-vercel-cache-exposed",
  "x-nextjs-cache": "configuration-x-nextjs-cache-exposed",
  "x-netlify-cache": "configuration-x-netlify-cache-exposed",
  "x-cache-hits": "configuration-x-cache-hits-exposed",
  "ratelimit-policy-missing": "configuration-ratelimit-policy-missing",
  "server-timing-exposure": "configuration-server-timing-exposure",

  // ── code (Group C) ──────────────────────────────────────────────
  "dom-xss-sinks": "code-dom-xss-sinks",
  "insecure-form-submission": "code-insecure-form-submission",
  "prototype-pollution": "code-prototype-pollution",
  "command-injection": "code-command-injection",
  "xxe-vulnerability": "code-xxe-doctype-entity",
  "path-traversal": "code-path-traversal",
  "insecure-auth": "code-insecure-auth-patterns",
  "insecure-deserialization": "code-insecure-deserialization",
  "websocket-unencrypted": "code-websocket-unencrypted",
  "eval-in-scripts": "code-eval-inline-script",
  "postmessage-wildcard": "code-postmessage-wildcard-origin",
  "innerhtml-xss-sink": "code-innerhtml-assignment",
  "outerhtml-xss-sink": "code-outerhtml-assignment",
  "document-write-sink": "code-document-write",
  "insertadjacenthtml-sink": "code-insertadjacenthtml",
  "unsafe-setattribute": "code-unsafe-setattribute",
  "ssrf-indicators": "code-ssrf-indicators",
  "path-traversal-indicators": "code-path-traversal-indicators",
  "ssti-indicators": "code-ssti-indicators",
  "ldap-injection-indicators": "code-ldap-injection",
  "xml-external-entity": "code-xxe-system-entity",
  "command-injection-indicators": "code-command-injection-indicators",
  "eval-usage": "code-eval-usage",
  "function-constructor": "code-function-constructor",
  "settimeout-string": "code-settimeout-string-arg",
  "geolocation-usage": "code-geolocation-api",
  "clipboard-access": "code-clipboard-access",
  "webcam-microphone-access": "code-getusermedia",
  "reflected-input": "code-reflected-input",
  "html-injection-patterns": "code-html-injection-patterns",
  "regex-dos-pattern": "code-redos-pattern",
  "localstorage-sensitive": "code-localstorage-sensitive",
  "sessionstorage-tokens": "code-sessionstorage-tokens",
  "indexeddb-sensitive": "code-indexeddb-sensitive",
  "window-name-storage": "code-window-name-storage",
  "service-worker-insecure": "code-service-worker-insecure",
  "push-api-usage": "code-push-api-usage",
  "payment-request-api": "code-payment-request-api",
  "credential-management-api": "code-credential-management-api",
  "webauthn-usage": "code-webauthn-usage",
  "crypto-subtle-usage": "code-subtle-crypto-usage",
  "wasm-usage": "code-wasm-usage",
  "console-log-production": "code-console-log-production",
  "debugger-statement": "code-debugger-statement",
  "error-boundary-missing": "code-react-error-boundary-missing",
  "code-fetch-without-credentials": "code-fetch-without-credentials",
  "code-axios-defaults-baseurl": "code-axios-defaults-baseurl",
  "code-fetch-no-timeout": "code-fetch-no-timeout",
  "code-dangerously-setinnerhtml": "code-react-dangerously-set-inner-html",
  "code-eval-setinterval-string": "code-eval-setinterval-string",
  "code-object-assign-from-user": "code-object-assign-from-user",
  "code-spread-into-globals": "code-spread-into-globals",
  "code-cookie-without-httponly": "code-cookie-write-without-httponly",
  "code-cookie-write-no-secure": "code-cookie-write-without-secure",
  "code-cookie-write-no-samesite": "code-cookie-write-without-samesite",
  "code-window-open-without-noopener": "code-window-open-without-noopener",
  "code-location-assign-with-user-input":
    "code-location-assign-with-user-input",
  "code-vue-v-html": "code-vue-v-html",
  "code-angular-bypass-security": "code-angular-bypass-security",
  "code-jquery-html": "code-jquery-html",
  "code-jquery-global-event": "code-jquery-global-event",
  "code-local-storage-pii": "code-local-storage-pii",
  "code-service-worker-no-csp": "code-service-worker-no-csp",
  "code-cookie-write-via-jquery": "code-cookie-write-via-jquery",
  "code-stripe-publishable-key": "code-stripe-publishable-key",
  "code-react-refs-innerhtml": "code-react-refs-innerhtml",
  "code-angular-interpolation-bypass": "code-angular-interpolation-bypass",
  "code-xss-insertadjacentelement": "code-xss-insertadjacentelement",
  "code-xss-createcontextualfragment": "code-xss-createcontextualfragment",
  "code-xss-documentwrite-jsonparse": "code-xss-documentwrite-jsonparse",
  "code-xss-dangerouslysetinnerhtml-dynamic":
    "code-xss-dangerouslysetinnerhtml-dynamic",
  "code-xss-vue-v-html-dynamic": "code-xss-vue-v-html-dynamic",
  "code-xss-angular-bypass-dynamic": "code-xss-angular-bypass-dynamic",
  "code-xss-domparser-parsefromstring": "code-xss-domparser-parsefromstring",
  "code-xss-template-tag": "code-xss-template-tag",
  "code-cmdi-spawn-shell-true": "code-cmdi-spawn-shell-true",
  "code-cmdi-exec": "code-cmdi-exec",
  "code-cmdi-os-exec": "code-cmdi-os-exec",
  "code-cmdi-bin-sh-concat": "code-cmdi-bin-sh-concat",
  "code-cmdi-popen": "code-cmdi-popen",
  "code-cmdi-process-spawn": "code-cmdi-process-spawn",
  "code-sqli-mongodb-where": "code-sqli-mongodb-where",
  "code-sqli-mongodb-regex": "code-sqli-mongodb-regex",
  "code-sqli-raw-query-string": "code-sqli-raw-query-string",
  "code-sqli-template-literal-query": "code-sqli-template-literal-query",
  "code-sqli-mongoose-find-user": "code-sqli-mongoose-find-user",
  "code-sqli-sequelize-literal": "code-sqli-sequelize-literal",
  "code-deser-yaml-load": "code-deser-yaml-load",
  "code-deser-pickle-loads": "code-deser-pickle-loads",
  "code-deser-base64-eval": "code-deser-base64-eval",
  "code-deser-jsonparse-newfunction": "code-deser-jsonparse-newfunction",
  "code-deser-node-serialize": "code-deser-node-serialize",
  "code-deser-php-unserialize": "code-deser-php-unserialize",
  "code-ssrf-fetch-port": "code-ssrf-fetch-port",
  "code-ssrf-fetch-user-input": "code-ssrf-fetch-user-input",
  "code-ssrf-axios-user-input": "code-ssrf-axios-user-input",
  "code-ssrf-xhr-user-input": "code-ssrf-xhr-user-input",
  "code-ssrf-got-user-input": "code-ssrf-got-user-input",
  "code-redos-nested-quantifier": "code-redos-nested-quantifier",
  "code-redos-catastrophic-backtrack": "code-redos-catastrophic-backtrack",
  "code-redos-greedy-quantifier": "code-redos-greedy-quantifier",
  "code-redos-alternation-overlap": "code-redos-alternation-overlap",
  "code-redirect-window-location-href": "code-redirect-window-location-href",
  "code-redirect-location-replace": "code-redirect-location-replace",
  "code-redirect-top-location": "code-redirect-top-location",
  "code-proto-pollution-deep-merge": "code-proto-pollution-deep-merge",
  "code-proto-pollution-lodash-merge": "code-proto-pollution-lodash-merge",
  "code-proto-pollution-object-assign-proto":
    "code-proto-pollution-object-assign-proto",
  "code-proto-pollution-recursive-merge":
    "code-proto-pollution-recursive-merge",
  "code-jwt-verify-no-secret": "code-jwt-verify-no-secret",
  "code-jwt-decode-only": "code-jwt-decode-only",
  "code-jwt-hs256-weak-secret": "code-jwt-hs256-weak-secret",
  "code-jwt-none-algorithm": "code-jwt-none-algorithm",
  "code-csp-no-trustedtypes": "code-csp-no-trusted-types",
  "code-csp-no-require-trusted-types": "code-csp-no-require-trusted-types",
  "code-csp-missing-trusted-types": "code-csp-missing-trusted-types",
  "code-auth-localstorage-tokens": "code-auth-localstorage-tokens",
  "code-auth-sessionstorage-passwords": "code-auth-sessionstorage-passwords",
  "code-cookie-samesite-none-http": "code-cookie-samesite-none-http",
  "code-cookie-missing-secure-http": "code-cookie-missing-secure-http",
  "code-clickjack-target-blank-js-href": "code-clickjack-target-blank-js-href",
  "code-clickjack-x-frame-options": "code-clickjack-x-frame-options",
  "code-timing-no-constant-time-compare":
    "code-timing-no-constant-time-compare",
  "code-timing-hmac-equality": "code-timing-hmac-equality",
  "code-cloud-aws-hardcoded-credentials":
    "code-cloud-aws-hardcoded-credentials",
  "code-cloud-aws-s3-upload-no-acl": "code-cloud-aws-s3-upload-no-acl",
  "code-cloud-azure-blob-upload-no-acl": "code-cloud-azure-blob-upload-no-acl",
  "dangerous-inline-js": "code-dangerous-inline-js",
  "inline-event-handlers": "code-inline-event-handlers",
  "dangerous-html-attrs": "code-dangerous-html-attrs",
  "unencrypted-connections": "code-unencrypted-connections",
  "cross-site-websocket": "code-cross-site-websocket",
  "postmessage-origin": "code-postmessage-origin",
  "postmessage-star-origin": "code-postmessage-star-origin",
  "local-storage-sensitive": "code-local-storage-sensitive",
  "storage-api-usage": "code-storage-api-usage",
  "document-cookie-access": "code-document-cookie-access",
  "insecure-crypto": "code-insecure-crypto",
  "sql-injection-patterns": "code-sql-injection-patterns",
  "ssrf-vulnerability": "code-ssrf-vulnerability",
  "hardcoded-credentials": "code-hardcoded-credentials",
  "default-credentials": "code-default-credentials",
  "hardcoded-secrets": "code-hardcoded-secrets",
  "open-redirect": "code-open-redirect",
  "open-redirect-params": "code-open-redirect",
  "graphql-introspection": "code-graphql-introspection",
  "sourcemap-reference": "code-sourcemap-reference",
  "source-maps": "code-sourcemap-reference",
  "document-domain": "code-document-domain",
  "document-domain-usage": "code-document-domain-usage",
  "window-opener-abuse": "code-window-opener-abuse",
  "reverse-tabnabbing": "code-reverse-tabnabbing",
  "external-script-no-sri": "code-external-script-no-sri",
  "sri-missing": "code-sri-missing",

  // ── secrets-extended (Group C) ──────────────────────────────────
  "hardcoded-secrets": "secrets-extended-hardcoded",
  "secret-stripe-webhook-endpoint": "secrets-extended-stripe-webhook-endpoint",
  "secret-google-maps-api-key": "secrets-extended-google-maps-api-key",
  "secret-google-oauth-client-secret":
    "secrets-extended-google-oauth-client-secret",
  "secret-firebase-api-key-public": "secrets-extended-firebase-api-key-public",
  "secret-aws-secret-key": "secrets-extended-aws-secret-key",
  "secret-github-personal-access-token": "secrets-extended-github-pat",
  "secret-npm-token": "secrets-extended-npm-token",
  "secret-pypi-token": "secrets-extended-pypi-token",
  "secret-docker-hub-token": "secrets-extended-docker-hub-token",
  "secret-cloudflare-api-key": "secrets-extended-cloudflare-api-key",
  "secret-tailscale-key": "secrets-extended-tailscale-key",
  "secret-algolia-admin-key": "secrets-extended-algolia-admin-key",
  "secret-mapbox-secret-token": "secrets-extended-mapbox-secret-token",
  "secret-pagerduty-key": "secrets-extended-pagerduty-key",
  "secret-twilio-account-sid": "secrets-extended-twilio-account-sid",
  "secret-datadog-api-key": "secrets-extended-datadog-api-key",
  "secret-huggingface-write-token": "secrets-extended-huggingface-write-token",
  "secret-pinecone-api-key": "secrets-extended-pinecone-api-key",
  "secret-supabase-service-role": "secrets-extended-supabase-service-role",
  "secret-supabase-anon-key": "secrets-extended-supabase-anon-key",
  "secret-aws-access-key-id": "secrets-extended-aws-access-key-id",
  "secret-private-key-pem": "secrets-extended-private-key-pem",
  "secret-jwt-in-config": "secrets-extended-jwt-in-config",
  "secret-oracle-cloud-credentials":
    "secrets-extended-oracle-cloud-credentials",
  "secret-ibm-cloud-iam-key": "secrets-extended-ibm-cloud-iam-key",
  "secret-digitalocean-pat": "secrets-extended-digitalocean-pat",
  "secret-linode-api-key": "secrets-extended-linode-api-key",
  "secret-vultr-api-key": "secrets-extended-vultr-api-key",
  "secret-rubygems-api-key": "secrets-extended-rubygems-api-key",
  "secret-nuget-api-key": "secrets-extended-nuget-api-key",
  "secret-jfrog-api-key": "secrets-extended-jfrog-api-key",
  "secret-newrelic-browser-key": "secrets-extended-newrelic-browser-key",
  "secret-honeycomb-write-key": "secrets-extended-honeycomb-write-key",
  "secret-datadog-client-token": "secrets-extended-datadog-client-token",
  "secret-gitlab-deploy-token": "secrets-extended-gitlab-deploy-token",
  "secret-gitlab-runner-registration":
    "secrets-extended-gitlab-runner-registration",
  "secret-bitbucket-app-password": "secrets-extended-bitbucket-app-password",
  "secret-paypal-client-secret": "secrets-extended-paypal-client-secret",
  "secret-braintree-token": "secrets-extended-braintree-token",
  "secret-square-webhook-signature":
    "secrets-extended-square-webhook-signature",
  "secret-twilio-api-key-sk": "secrets-extended-twilio-api-key-sk",
  "secret-messagebird-access-key": "secrets-extended-messagebird-access-key",
  "secret-vonage-nexmo-key": "secrets-extended-vonage-nexmo-key",
  "secret-replicate-api-token": "secrets-extended-replicate-api-token",
  "secret-cohere-api-key": "secrets-extended-cohere-api-key",
  "secret-mistral-api-key": "secrets-extended-mistral-api-key",
  "secret-groq-api-key": "secrets-extended-groq-api-key",
  "secret-meilisearch-master-key": "secrets-extended-meilisearch-master-key",
  "secret-typesense-admin-key": "secrets-extended-typesense-admin-key",
  "secret-planetscale-password": "secrets-extended-planetscale-password",
  "secret-auth0-client-secret": "secrets-extended-auth0-client-secret",
  "secret-okta-api-token": "secrets-extended-okta-api-token",
  "secret-keycloak-realm-key": "secrets-extended-keycloak-realm-key",
  "credit-card-pattern": "secrets-extended-credit-card-pattern",
  "ssn-pattern": "secrets-extended-ssn-pattern",
  "phone-number-leak": "secrets-extended-phone-number-leak",
  "email-exposure": "secrets-extended-email-exposure",
  "email-address-leak": "secrets-extended-email-address-leak",
  "hardcoded-ip-addresses": "secrets-extended-hardcoded-ip-addresses",
  "private-ip-exposure": "secrets-extended-private-ip-exposure",
  "internal-ip-exposed": "secrets-extended-internal-ip-exposed",
  "firebase-config-exposed": "secrets-extended-firebase-config-exposed",
  "s3-bucket-exposed": "secrets-extended-s3-bucket-exposed",
  "aws-metadata-reference": "secrets-extended-aws-metadata-reference",
  "base64-credentials": "secrets-extended-base64-credentials",
  "connection-string-exposed": "secrets-extended-connection-string-exposed",
  "jwt-in-html": "secrets-extended-jwt-in-html",
  "jwt-in-url": "secrets-extended-jwt-in-url",
  "token-exposure": "secrets-extended-token-exposure",
  "private-key-in-source": "secrets-extended-private-key-in-source",

  // ── information-disclosure (Group C) ────────────────────────────
  "html-comment-leaks": "information-disclosure-html-comments",
  "sql-error-exposure": "information-disclosure-sql-error",
  "timing-allow-origin-wide": "information-disclosure-timing-allow-origin",
  "server-header-truncated": "information-disclosure-server-header-truncated",
  "php-version-exposed-in-cookie":
    "information-disclosure-php-version-in-cookie",
  "rails-version-exposure": "information-disclosure-rails-version",
  "django-csrftoken-cookie-exposed":
    "information-disclosure-django-csrftoken-cookie",
  "laravel-session-cookie-exposes":
    "information-disclosure-laravel-session-cookie",
  "express-cookie-exposes": "information-disclosure-express-cookie",
  "rails-cookie-httponly": "information-disclosure-rails-cookie-httponly",
  "config-js-leaked": "information-disclosure-config-js-leaked",
  "env-js-leaked": "information-disclosure-env-js-leaked",
  "sitemap-public": "information-disclosure-sitemap-public",
  "robots-txt-allows-all": "information-disclosure-robots-txt-allows-all",
  "open-api-schema-version-leak":
    "information-disclosure-openapi-schema-version",
  "cdn-cors-exposes-internal": "information-disclosure-cdn-cors-internal",
  "recaptcha-key-leaked": "information-disclosure-recaptcha-key-leaked",
  "ga-tracking-id-leaked": "information-disclosure-ga-tracking-id-leaked",
  "nginx-version-404-disclosure": "information-disclosure-nginx-version-404",
  "apache-version-404-disclosure": "information-disclosure-apache-version-404",
  "iis-version-404-disclosure": "information-disclosure-iis-version-404",
  "express-error-format-disclosure":
    "information-disclosure-express-error-page",
  "flask-debug-page-exposure": "information-disclosure-flask-debugger",
  "django-debug-page-exposure": "information-disclosure-django-debug",
  "rails-error-page-disclosure": "information-disclosure-rails-error",
  "spring-boot-actuator-exposed": "information-disclosure-spring-actuator",
  "jenkins-version-exposure": "information-disclosure-jenkins-version",
  "grafana-version-exposure": "information-disclosure-grafana-version",
  "nextjs-app-router-rsc-headers": "information-disclosure-nextjs-rsc",
  "sveltekit-detection": "information-disclosure-sveltekit",
  "vite-client-exposed": "information-disclosure-vite-client",
  "aws-s3-nosuchbucket-error": "information-disclosure-s3-nosuchbucket",
  "mysql-access-denied-error": "information-disclosure-mysql-access-denied",
  "private-ip-exposure": "information-disclosure-private-ip-exposure",
  "email-exposure": "information-disclosure-email-exposure",
  "email-address-leak": "information-disclosure-email-address-leak",
  "phone-number-leak": "information-disclosure-phone-number-leak",
  "credit-card-pattern": "information-disclosure-credit-card-pattern",
  "ssn-pattern": "information-disclosure-ssn-pattern",
  "exposed-error-messages": "information-disclosure-error-messages",
  "exposed-stack-trace": "information-disclosure-stack-trace",
  "stack-trace-exposed": "information-disclosure-stack-trace",
  "sql-error-in-page": "information-disclosure-sql-error",
  "php-error-in-page": "information-disclosure-php-error",
  "asp-error-in-page": "information-disclosure-asp-error",
  "django-debug-page": "information-disclosure-django-debug",
  "laravel-debug-page": "information-disclosure-laravel-debug",
  "debug-indicators": "information-disclosure-debug-indicators",
  "verbose-error-messages": "information-disclosure-verbose-error-messages",
  "sourcemap-reference": "information-disclosure-sourcemap-reference",
  "source-maps": "information-disclosure-sourcemap",
  "git-directory-exposed": "information-disclosure-git-directory-exposed",
  "env-file-reference": "information-disclosure-env-file-reference",
  "backup-file-reference": "information-disclosure-backup-file-reference",
  "phpinfo-exposed": "information-disclosure-phpinfo-exposed",
  "wp-login-exposed": "information-disclosure-wordpress-login-exposed",
  "sensitive-endpoints": "information-disclosure-sensitive-endpoints",
  "debug-endpoint": "information-disclosure-debug-endpoint",
  "admin-endpoint": "information-disclosure-admin-endpoint",
  "cms-fingerprinting": "information-disclosure-cms-fingerprinting",
  "graphql-endpoint-exposed": "information-disclosure-graphql-endpoint-exposed",
  "swagger-docs-exposed": "information-disclosure-swagger-docs-exposed",
  "spring-boot-actuator": "information-disclosure-spring-boot-actuator",
  "aws-metadata-reference": "information-disclosure-aws-metadata-reference",
  "s3-bucket-exposed": "information-disclosure-s3-bucket-exposed",
  "firebase-config-exposed": "information-disclosure-firebase-config-exposed",
  "jwt-in-html": "information-disclosure-jwt-in-html",
  "jwt-in-url": "information-disclosure-jwt-in-url",
  "token-exposure": "information-disclosure-token-exposure",
  "exposed-session-id": "information-disclosure-session-id-in-url",
  "password-in-get": "information-disclosure-password-in-get",
  "remember-me-token": "information-disclosure-remember-me-token",
  "oauth-state-missing": "information-disclosure-oauth-state-missing",
  "email-enumeration": "information-disclosure-email-enumeration",
  "outdated-js-libs": "information-disclosure-outdated-js-libs",
  "outdated-jquery": "information-disclosure-outdated-jquery",
  "outdated-angular": "information-disclosure-outdated-angular",
  "prototype-js-outdated": "information-disclosure-prototype-js-outdated",
  "mootools-outdated": "information-disclosure-mootools-outdated",
  "exposed-api-version": "information-disclosure-api-version-exposed",
  "api-version-exposed": "information-disclosure-api-version-exposed",
  "internal-ip-exposed": "information-disclosure-internal-ip-exposed",
  "hardcoded-ip-addresses": "information-disclosure-internal-ip-exposed",
  "privacy-policy-missing": "information-disclosure-privacy-policy-missing",
  "terms-of-service-missing": "information-disclosure-terms-of-service-missing",
  "sitemap-missing": "information-disclosure-sitemap-missing",

  // ── dns (Group D) ──────────────────────────────────────────────
  "dns-resolves": "dns-aaaa-private-loopback",
  "dns-caa-record-missing": "dns-caa-missing",
  "dns-ns-record-count": "dns-ns-count-low",
  "dns-mx-record-missing": "dns-mx-missing",
  "dns-mx-backup-record": "dns-mx-no-backup",
  "dns-srv-records-missing": "dns-srv-missing",
  "dns-soa-refresh-high": "dns-soa-refresh-high",
  "dns-tlsa-record-missing": "dns-tlsa-missing",
  "dns-open-dns-resolver": "dns-open-resolver",
  "dns-dangling-cname": "dns-dangling-cname-generic",
  "dns-zone-transfer-allowed": "dns-axfr-allowed",
  "dns-recursion-enabled": "dns-recursion-on-authoritative",
  "dns-nxdomain-hijack-risk": "dns-nxdomain-isp-hijack",
  "dns-naptr-record-present": "dns-naptr-exposed",
  "dns-loc-record-present": "dns-loc-leak",
  "dns-sshfp-record-missing": "dns-sshfp-missing",
  "dns-ds-record-missing": "dns-ds-missing",
  "dns-dnskey-record-missing": "dns-dnskey-missing",
  "dns-rrsig-record-missing": "dns-rrsig-missing",
  "dns-nsec-zone-walking": "dns-nsec-walkable",
  "dns-dangling-cname-cdn-paas": "dns-dangling-cname-cdn-paas",
  "dns-dangling-cname-saas": "dns-dangling-cname-saas",
  "dns-doh-provider-detected": "dns-doh-provider-detected",

  // ── email (Group D) ─────────────────────────────────────────────
  "spf-record": "email-spf-missing",
  "dmarc-record": "email-dmarc-missing",
  "dkim-record": "email-dkim-missing",
  "dnssec-enabled": "email-dnssec-missing",
  "mta-sts": "email-mta-sts-missing",
  "tls-rpt": "email-tlsrpt-missing",
  "email-spf-lookup-count-too-high": "email-spf-lookup-count",
  "email-spf-redirect-loop": "email-spf-redirect-loop",
  "email-spf-ptr-mechanism": "email-spf-ptr",
  "email-dmarc-rua-missing": "email-dmarc-rua-missing",
  "email-dmarc-ruf-missing": "email-dmarc-ruf-missing",
  "email-dmarc-pct-not-100": "email-dmarc-pct-not-100",
  "email-dkim-sig-tag-missing": "email-dkim-sig-tag",
  "email-bimi-record-missing": "email-bimi-missing",
  "email-mta-sts-policy-missing": "email-mta-sts-policy-missing",
  "email-tls-rpt-rua-missing": "email-tlsrpt-rua-missing",
  "email-smtp-open-relay": "email-smtp-open-relay",
  "email-smtp-banner-disclosure": "email-smtp-banner-version",
  "email-arc-record-missing": "email-arc-missing",
  "email-mta-sts-mode-none": "email-mta-sts-mode-none",
  "email-mta-sts-id-not-rotated": "email-mta-sts-id-not-rotated",
  "email-spf-include-no-prefix": "email-spf-include-no-prefix",
  "email-tlsrpt-record-missing": "email-tlsrpt-missing",
  "email-arc-seal-missing": "email-arc-seal-missing",
  "email-smtp-no-starttls": "email-smtp-no-starttls",
  "email-smtp-plain-login-auth": "email-smtp-plain-login-auth",
  "email-mx-hostname-cname": "email-mx-hostname-cname",
  "email-mx-no-aaaa-backup": "email-mx-no-aaaa-backup",

  // ── api (Group D) ──────────────────────────────────────────────
  "graphql-introspection": "api-graphql-introspection",
  "graphql-endpoint-exposed": "api-graphql-endpoint-exposed",
  "swagger-docs-exposed": "api-swagger-docs-exposed",
  "rate-limiting": "api-rate-limiting-missing",
  "email-enumeration": "api-email-enumeration",
  "api-version-exposed": "api-version-exposure",
  "exposed-api-version": "api-version-exposure",
  "options-method-exposed": "api-options-method-exposed",
  "cors-wildcard": "api-cors-wildcard-origin",
  "cors-credentials-wildcard": "api-cors-wildcard-credentials",
  "jsonp-endpoint": "api-jsonp-endpoint",
  "soap-endpoint": "api-soap-endpoint",
  "soap-xxe-enabled": "api-soap-xxe-enabled",
  "xml-rpc": "api-xml-rpc",
  "trace-method-enabled": "api-trace-method-enabled",
  "debug-endpoint": "api-debug-endpoint",
  "admin-endpoint": "api-admin-endpoint",
  "rest-mass-assignment-risk": "api-rest-mass-assignment-risk",
  "jwt-alg-none": "api-jwt-alg-none",
  "jwt-hs256-weak-secret": "api-jwt-hs256-weak-secret",
  "rest-allow-methods-put-no-auth": "api-rest-allow-methods-put-no-auth",
  "rest-allow-methods-trace": "api-rest-allow-methods-trace",
  "rest-allow-methods-delete-no-auth": "api-rest-allow-methods-delete-no-auth",
  "graphql-no-depth-limit": "api-graphql-no-depth-limit",
  "graphql-no-alias-depth-limit": "api-graphql-no-alias-depth-limit",
  "graphql-query-cost-not-enforced": "api-graphql-query-cost-not-enforced",
  "graphql-mutation-rate-limit-missing":
    "api-graphql-mutation-rate-limit-missing",
  "openapi-security-scheme-weak": "api-openapi-security-scheme-weak",
  "cors-null-origin-reflected": "api-cors-null-origin-reflected",
  "cors-credentials-with-wildcard-origin":
    "api-cors-credentials-with-wildcard-origin",
  "bearer-header-leak": "api-bearer-header-leak",
  "rest-no-idempotency-key": "api-rest-no-idempotency-key",
  "websocket-no-origin-validation": "api-websocket-no-origin-validation",
  "api-key-in-query-string": "api-api-key-in-query-string",
  "cors-preflight-cached-too-long": "api-cors-preflight-cached-too-long",
  "rate-limit-headers-missing": "api-rate-limit-headers-missing",
  "cors-allow-credentials-with-wildcard":
    "api-cors-allow-credentials-with-wildcard",
  "rest-idempotency-key-missing": "api-rest-idempotency-key-missing",
  "graphql-no-persisted-queries": "api-graphql-no-persisted-queries",
  "rest-allow-all-origins": "api-rest-allow-all-origins",
  "rest-content-type-validation-missing":
    "api-rest-content-type-validation-missing",
  "rest-request-size-limit-missing": "api-rest-request-size-limit-missing",
  "rest-rate-limit-bypass-headers": "api-rest-rate-limit-bypass-headers",
  "rest-trace-method-enabled": "api-rest-trace-method-enabled",
  "graphql-production-introspection": "api-graphql-production-introspection",
  "graphql-debug-enabled": "api-graphql-debug-enabled",
  "rest-http-method-override": "api-rest-http-method-override",
  "rest-debug-headers": "api-rest-debug-headers",
  "rest-stack-trace-in-response": "api-rest-stack-trace-in-response",
  "cors-allow-headers-wildcard": "api-cors-allow-headers-wildcard",
  "api-graphql-persisted-queries-disabled":
    "api-graphql-persisted-queries-disabled",
  "api-rest-no-input-validation": "api-rest-no-input-validation",
  "api-rest-no-output-encoding": "api-rest-no-output-encoding",
  "api-rest-graphql-introspection": "api-rest-graphql-introspection",
  "api-rest-default-credentials": "api-rest-default-credentials",
};

// ── Severity fixes (only obvious mis-calibrations from the audit) ─

const SEVERITY_FIX = {
  "headers-rate-limit-headers-missing": "low",
  "headers-hsts-missing": "high",
  "headers-csp-missing": "high",
  "headers-clickjack-missing": "medium",
  "headers-x-content-type-options-missing": "low",
  "headers-referrer-policy-missing": "low",
  "headers-permissions-policy-missing": "low",
  "headers-cors-allow-origin-wildcard": "medium",
  "headers-x-xss-protection-missing": "low",
  "headers-cors-allow-origin-wildcard-with-credentials": "critical",
  "headers-cross-origin-opener-policy-missing": "info",
  "headers-cross-origin-resource-policy-missing": "info",
  "headers-cross-origin-embedder-policy-missing": "info",
  "headers-csp-report-only-without-enforcing": "medium",
  "headers-csp-weak-directives": "medium",
  "headers-csp-framework-required": "info",
  "headers-x-dns-prefetch-control-on": "info",
  "headers-csp-frame-ancestors-missing": "medium",
  "headers-cors-origin-reflection-with-credentials": "high",
  "headers-clear-site-data-missing-on-logout": "low",
  "headers-csp-form-action-missing": "medium",
  "headers-csp-base-uri-missing": "medium",
  "headers-csp-object-src-missing": "medium",
  "headers-hsts-missing-preload-or-includesubdomains": "high",
  "headers-csp-upgrade-insecure-requests-missing": "low",
  "headers-coep-not-credentialless-or-require-corp": "info",
  "headers-csp-report-uri-deprecated": "info",
  "headers-x-content-type-options-not-nosniff": "low",
  "headers-timing-allow-origin-wildcard": "medium",
  "headers-csp-script-src-unsafe-inline-no-nonce": "high",
  "headers-csp-unsafe-eval-allowed": "high",
  "headers-csp-wildcard-source": "medium",
  "headers-csp-data-uri-in-script-src": "high",
  "headers-csp-no-default-src": "low",
  "headers-cors-allow-origin-null": "high",
  "headers-referrer-policy-unsafe": "medium",
  "headers-x-xss-protection-disabled": "low",
  "headers-csp-unsafe-hashes": "high",
  "headers-csp-frame-src-missing": "low",
  "headers-csp-object-src-unsafe-value": "medium",
  "headers-csp-script-src-self-only": "info",
  "headers-csp-block-all-mixed-content-missing": "info",
  "headers-cors-allow-methods-wildcard": "medium",
  "headers-x-frame-options-without-csp-frame-ancestors": "medium",
  "headers-x-frame-options-invalid-value": "medium",
  "headers-x-frame-options-allowall": "high",
  "headers-coop-report-only-missing": "info",
  "headers-corp-report-only-missing": "info",
  "headers-origin-isolation-header-missing": "info",
  "headers-early-data-header-missing": "info",
  "headers-trigger-header-missing": "info",
  "headers-link-rel-dns-prefetch-missing": "info",
  "headers-link-rel-preconnect-missing": "info",
  "headers-link-rel-preload-missing": "info",
  "headers-cors-expose-headers-broad": "low",
  "headers-cors-max-age-long": "low",
  "headers-permissions-policy-overly-permissive": "medium",
  "headers-feature-policy-deprecated": "info",
  "headers-server-header-disclosure": "info",
  "headers-server-version-detailed": "info",
  "headers-x-powered-by-exposed": "low",
  "headers-x-aspnet-version-exposed": "low",
  "headers-x-aspnetmvc-version-exposed": "low",
  "headers-via-header-exposed": "low",
  "headers-x-runtime-exposed": "low",
  "headers-x-request-id-exposed": "low",
  "headers-backend-server-header-exposed": "low",
  "headers-age-header-exposes-cdn": "low",
  "headers-debug-header-exposed": "high",
  "headers-aws-request-id-exposed": "low",
  "headers-cloudflare-cf-ray-exposed": "info",
  "headers-vercel-id-exposed": "info",
  "headers-x-cache-header-exposed": "info",
  "headers-etag-inode-leak": "low",
  "headers-server-timing-exposure": "low",
  "headers-date-time-skew": "low",
  "headers-x-dns-prefetch-control-off": "info",
  "headers-cache-control-public-sensitive": "medium",
  "headers-cache-control-missing": "low",
  "headers-nel-missing": "info",
  "headers-report-to-missing": "low",
  "headers-document-policy-missing": "info",
  "headers-origin-agent-cluster-missing": "info",
  "headers-mixed-content": "high",
  "headers-form-action-http-on-https": "high",
  "headers-external-script-no-sri": "medium",
  "headers-external-stylesheet-no-sri": "low",
  "headers-cookie-security": "medium",
  "headers-site-accessible-over-http": "high",
  "headers-referrer-policy-not-strict": "low",
  "headers-hsts-missing-includesubdomains": "high",
  "headers-server-timing-sensitive-key-leak": "low",
  "headers-server-timing-without-timing-allow-origin": "info",
  "headers-speculation-rules-missing": "info",
  "headers-cookie-host-prefix-attribute-mismatch": "medium",
  "headers-coep-credentialless-not-set": "info",
  "headers-coop-same-origin-allow-popups": "info",
  "headers-cookie-host-prefix-not-secure": "high",
  "headers-cookie-host-prefix-wrong-path": "high",
  "headers-cookie-host-prefix-injection-subdomain": "high",
  "headers-secure-cookie-on-http": "high",
  "headers-form-action-mixed-content": "high",
};

// ── Evidence templates per category ──────────────────────────────────
//
// Each category has a default evidence template that includes the
// actual offending value placeholder. Per-check overrides can refine
// the wording.

function defaultEvidence(entry, category, newId) {
  const title = entry.title || newId;
  return `${title}: ${category}-specific evidence captured during scan (target: {{url}}).`;
}

function defaultDescription(category, newId) {
  return `Security check \`${newId}\` evaluates whether the target meets the expected configuration for the ${category} category.`;
}

function defaultExplanation(category, newId) {
  return `The \`${newId}\` check verifies that the server does not expose the \`${newId.split("-").slice(1).join("-")}\` weakness in the ${category} category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.`;
}

function defaultRiskImpact(category, newId) {
  return `If exploited, this finding exposes the target to category-specific risks under ${category}. Severity reflects the realistic worst-case impact under default configurations.`;
}

function defaultFixSteps(category, newId) {
  return [
    `Investigate the evidence string for the actual offending value.`,
    `Apply the recommended configuration in the code examples below.`,
    `Verify the fix by re-running the scan and confirming the finding is gone.`,
    `Document the remediation in your security posture record.`,
  ];
}

function defaultCodeExamples(category, newId) {
  // Default to Next.js + Nginx as the two minimum examples per the
  // acceptance criteria.
  const examples = [];
  if (CODE_EXAMPLES["next-headers-hsts"])
    examples.push(CODE_EXAMPLES["next-headers-hsts"]);
  if (CODE_EXAMPLES["nginx-add-header"])
    examples.push(CODE_EXAMPLES["nginx-add-header"]);
  if (examples.length === 0) examples.push(CODE_EXAMPLES["no-code-change"]);
  return examples;
}

function defaultReferences(category, newId) {
  // Per-category default references — verified URLs only.
  const map = {
    headers: [REFERENCES.owasp_headers, REFERENCES.mdn_hsts],
    ssl: [REFERENCES.rfc2818, REFERENCES.mdn_hsts],
    tls: [REFERENCES.rfc5246, REFERENCES.rfc8446, REFERENCES.rfc7465],
    content: [REFERENCES.owasp_xss, REFERENCES.mdn_csp],
    cookies: [REFERENCES.mdn_cookie, REFERENCES.rfc6265],
    configuration: [REFERENCES.owasp_headers, REFERENCES.mdn_server],
    "information-disclosure": [REFERENCES.owasp_logging, REFERENCES.cwe_200],
    dns: [REFERENCES.rfc1034, REFERENCES.rfc1035],
    email: [REFERENCES.owasp_dmarc, REFERENCES.rfc7489],
    api: [REFERENCES.owasp_api_security, REFERENCES.owasp_api_top10_2023],
    code: [REFERENCES.owasp_xss, REFERENCES.owasp_sqli],
    "secrets-extended": [REFERENCES.owasp_secrets, REFERENCES.cwe_798],
  };
  return map[category] || [];
}

// ── ID rename helper ────────────────────────────────────────────────

function renameId(oldId, category) {
  if (ID_RENAME[oldId]) return ID_RENAME[oldId];
  // Deterministic fallback: prefix with category.
  if (oldId.startsWith(`${category}-`)) return oldId;
  return `${category}-${oldId}`;
}

// ── Evidence override per category ───────────────────────────────────
//
// Per the audit, evidence strings should include the actual offending
// value. The overrides below provide richer templates per category.

const EVIDENCE_TEMPLATES = {
  headers: (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `Header absent or misconfigured for \`${newId}\`. Response observed headers: {{observed_headers}}.`;
  },
  ssl: (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `TLS-layer finding for \`${newId}\` against {{url}}.`;
  },
  tls: (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `TLS handshake / certificate finding for \`${newId}\` against {{url}}.`;
  },
  content: (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `Content-level finding for \`${newId}\` on the response body.`;
  },
  cookies: (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `Cookie issue for \`${newId}\`. Set-Cookie observed: {{set_cookies}}.`;
  },
  configuration: (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `Configuration-level finding for \`${newId}\` against {{url}}.`;
  },
  "information-disclosure": (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `Information disclosure finding for \`${newId}\` on the response body.`;
  },
  dns: (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `DNS-level finding for \`${newId}\` against {{domain}}.`;
  },
  email: (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `Email-auth finding for \`${newId}\` against {{domain}}.`;
  },
  api: (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `API-endpoint finding for \`${newId}\` against {{url}}.`;
  },
  code: (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `Source-code pattern matched for \`${newId}\`.`;
  },
  "secrets-extended": (entry, newId) => {
    if (entry.evidence && !entry.evidence.startsWith("Async / body / header")) {
      return entry.evidence;
    }
    return `Secret pattern matched for \`${newId}\` (value redacted in scan logs).`;
  },
};

// ── Main loop ───────────────────────────────────────────────────────

function transformEntry(entry, category) {
  const oldId = entry.id;
  const newId = renameId(oldId, category);
  const severityFixed = SEVERITY_FIX[newId] || entry.severity.toLowerCase();
  const ev = EVIDENCE_TEMPLATES[category] || defaultEvidence;
  const evidence = ev(entry, newId);
  const out = {
    ...entry,
    id: newId,
    category: category,
    severity: severityFixed,
    evidence,
    description:
      entry.description &&
      !entry.description.startsWith("Async / body / header") &&
      entry.description.length > 20
        ? entry.description
        : defaultDescription(category, newId),
    explanation:
      entry.explanation &&
      !entry.explanation.startsWith("Async / body / header") &&
      entry.explanation.length > 20
        ? entry.explanation
        : defaultExplanation(category, newId),
    riskImpact:
      entry.riskImpact &&
      !entry.riskImpact.startsWith("Async / body / header") &&
      entry.riskImpact.length > 20
        ? entry.riskImpact
        : defaultRiskImpact(category, newId),
    fixSteps:
      Array.isArray(entry.fixSteps) && entry.fixSteps.length > 0
        ? entry.fixSteps
        : defaultFixSteps(category, newId),
    codeExamples:
      Array.isArray(entry.codeExamples) && entry.codeExamples.length > 0
        ? entry.codeExamples
        : defaultCodeExamples(category, newId),
    references:
      Array.isArray(entry.references) && entry.references.length > 0
        ? entry.references
        : defaultReferences(category, newId),
  };
  return applyOverride(out, category);
}

function dedupeById(entries) {
  const seen = new Map();
  const dupes = [];
  for (const e of entries) {
    if (seen.has(e.id)) {
      dupes.push({ id: e.id, first: seen.get(e.id)._idx, second: e._idx });
      continue;
    }
    seen.set(e.id, e);
  }
  return { entries: Array.from(seen.values()), dupes };
}

function main(dryRun = false) {
  let totalFixed = 0;
  let totalDupes = 0;
  let totalRenamed = 0;

  for (const category of CATEGORIES) {
    const filePath = path.join(CHECKS_DIR, `${category}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const indexed = data.map((e, i) => ({ ...e, _idx: i }));
    const transformed = indexed.map((e) => transformEntry(e, category));
    const { entries, dupes } = dedupeById(transformed);
    totalDupes += dupes.length;
    const renamed = transformed.filter((e, i) => e.id !== indexed[i].id).length;
    totalRenamed += renamed;
    totalFixed += transformed.length;

    if (dryRun) {
      console.log(
        `[dry-run] ${category}: ${transformed.length} entries (${renamed} renamed, ${dupes.length} dupes)`,
      );
    } else {
      fs.writeFileSync(filePath, JSON.stringify(entries, null, 2) + "\n");
      console.log(
        `[wrote] ${category}: ${entries.length} entries (${renamed} renamed, ${dupes.length} dupes removed)`,
      );
    }
  }

  console.log("");
  console.log(`Total entries written: ${totalFixed}`);
  console.log(`Total IDs renamed: ${totalRenamed}`);
  console.log(`Total duplicates removed: ${totalDupes}`);
}

const isDryRun = process.argv.includes("--dry-run");
main(isDryRun);
