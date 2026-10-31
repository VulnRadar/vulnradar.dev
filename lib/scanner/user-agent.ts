/**
 * The User-Agent strings the scanner sends to the sites it scans.
 *
 * Every request that reaches a scan target names SCANNER_UA_PRODUCT, so a site
 * owner who wants to let scan traffic through, or to recognise it and block
 * it, can write one contains-match rule against that token and have it cover
 * the page fetch, the TLS and header probes, the crawler, the active probes
 * and the authenticated login alike. A User-Agent is trivially spoofed, so
 * such a rule is a convenience and never a guarantee.
 *
 * The variants differ in shape on purpose, and the shapes are not
 * interchangeable:
 *
 *  - SCANNER_UA is the `Mozilla/5.0 (compatible; ...)` form that crawler
 *    allowlists and bot-detection rules look for, with the contact URL.
 *  - The crawler's `(Crawler)` form (crawl-discovery.ts) is also the token a
 *    site's robots.txt addresses (`User-agent: VulnRadar`), and tests pin it.
 *  - The authenticated and active-probe forms say what the request is doing,
 *    so an owner reading their access log can tell a login from a form probe.
 *
 * Build any new variant from SCANNER_UA_PRODUCT rather than writing the name
 * and version out again: a second copy is how a request ends up without it.
 * tests/lib/scanner/user-agent.test.ts checks the call sites.
 */

import { APP_NAME, APP_URL } from "@/lib/config/client-constants";

/** The token every target-facing User-Agent carries. */
export const SCANNER_UA_PRODUCT = `${APP_NAME}/1.0`;

/** Page and TLS fetches and the live-fetch probes (robots.txt, exposed files, CORS and method checks). */
export const SCANNER_UA = `Mozilla/5.0 (compatible; ${SCANNER_UA_PRODUCT}; +${APP_URL})`;

/** The login and verification requests of an authenticated scan. */
export const SCANNER_UA_AUTHENTICATED = `${SCANNER_UA_PRODUCT} (Security Scanner; Authenticated)`;

/** The opt-in probes that submit a canary through a form on the page. */
export const SCANNER_UA_ACTIVE_PROBE = `${SCANNER_UA_PRODUCT} (Security Scanner; Active Probe; +${APP_URL})`;

/** The third-party sources subdomain discovery asks. Not the scan target. */
export const SCANNER_UA_DISCOVERY = `Mozilla/5.0 (compatible; ${SCANNER_UA_PRODUCT})`;
