/**
 * Hosting platforms that hand out subdomains of a zone they own.
 *
 * The owner of `shop.vercel.app` cannot publish an SPF, DKIM, MX, TLSA or
 * wildcard record anywhere: the zone belongs to Vercel, and so do the mail
 * records on it. Scanning those names as if they were the owner's produced
 * pages of findings nobody could act on (53 distinct DNS or email findings on
 * eight platform hosts in one real export). A strict subdomain of one of these
 * suffixes is therefore "not applicable" for everything that needs DNS control
 * of the zone. The platform's own apex (`vercel.app` itself) is still a normal
 * target: its operator does own that zone.
 *
 * Why a curated list and not the Public Suffix List alone: the PSL private
 * section is the right source for most of these, but it lacks jimdofree.com,
 * great-site.net, mysellauth.com, selfhost.eu and others that real scans hit.
 * It is also deliberately NOT folded into extractRootDomain: that function
 * keys per-root-domain rate limits and subdomain discovery, and treating
 * `vercel.app` as a public suffix there would change both for every tenant.
 *
 * Pure on purpose (no scanner imports beyond the root-domain helper and no
 * I/O), so any layer can ask.
 */

import { isIP } from "net";
import { extractRootDomain } from "./root-domain";

export interface PlatformSuffix {
  /** The zone the platform owns, lower case, no leading dot. */
  suffix: string;
  /** Operator name, for a message that says whose zone it is. */
  name: string;
}

const PLATFORMS: readonly PlatformSuffix[] = [
  // Seen in scan exports: owners of these hosts were handed findings they
  // could not act on.
  { suffix: "vercel.app", name: "Vercel" },
  { suffix: "blogspot.com", name: "Blogger" },
  { suffix: "jimdofree.com", name: "Jimdo" },
  { suffix: "great-site.net", name: "InfinityFree" },
  { suffix: "mysellauth.com", name: "SellAuth" },
  { suffix: "lovable.app", name: "Lovable" },
  { suffix: "selfhost.eu", name: "selfhost.eu" },

  // Public Suffix List, private section: each is a zone whose tenants get a
  // label but no control over the zone.
  { suffix: "github.io", name: "GitHub Pages" },
  { suffix: "gitlab.io", name: "GitLab Pages" },
  { suffix: "netlify.app", name: "Netlify" },
  { suffix: "herokuapp.com", name: "Heroku" },
  { suffix: "pages.dev", name: "Cloudflare Pages" },
  { suffix: "workers.dev", name: "Cloudflare Workers" },
  { suffix: "trycloudflare.com", name: "Cloudflare Tunnel" },
  { suffix: "web.app", name: "Firebase Hosting" },
  { suffix: "firebaseapp.com", name: "Firebase Hosting" },
  { suffix: "onrender.com", name: "Render" },
  { suffix: "fly.dev", name: "Fly.io" },
  { suffix: "replit.app", name: "Replit" },
  { suffix: "repl.co", name: "Replit" },
  { suffix: "wixsite.com", name: "Wix" },
  { suffix: "myshopify.com", name: "Shopify" },
  { suffix: "webflow.io", name: "Webflow" },
  { suffix: "carrd.co", name: "Carrd" },
  { suffix: "notion.site", name: "Notion" },
  { suffix: "framer.website", name: "Framer" },
  { suffix: "framer.app", name: "Framer" },
  { suffix: "azurewebsites.net", name: "Azure App Service" },
  { suffix: "azurestaticapps.net", name: "Azure Static Web Apps" },
  { suffix: "cloudfront.net", name: "Amazon CloudFront" },
  { suffix: "surge.sh", name: "Surge" },
  { suffix: "streamlit.app", name: "Streamlit" },
  { suffix: "hf.space", name: "Hugging Face Spaces" },
  { suffix: "gitbook.io", name: "GitBook" },
  { suffix: "now.sh", name: "Vercel" },
  { suffix: "vercel.dev", name: "Vercel" },
  { suffix: "ngrok-free.app", name: "ngrok" },
  { suffix: "ngrok.io", name: "ngrok" },

  // Not in the Public Suffix List but the same situation (checked absent).
  { suffix: "jimdosite.com", name: "Jimdo" },
  { suffix: "infinityfreeapp.com", name: "InfinityFree" },
  { suffix: "epizy.com", name: "InfinityFree" },
  { suffix: "rf.gd", name: "InfinityFree" },
  { suffix: "42web.io", name: "InfinityFree" },
  { suffix: "railway.app", name: "Railway" },
  { suffix: "glitch.me", name: "Glitch" },
  { suffix: "weebly.com", name: "Weebly" },
  { suffix: "ghost.io", name: "Ghost" },
  { suffix: "loca.lt", name: "localtunnel" },
];

function normalise(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
}

/**
 * The platform whose zone `hostname` is a STRICT subdomain of, or null.
 *
 * Matches on label boundaries: `x.vercel.app` matches, `vercel.app` itself
 * does not (the operator owns that zone), and neither `notvercel.app` nor
 * `vercel.app.example.com` does.
 */
export function platformOf(hostname: string): PlatformSuffix | null {
  const host = normalise(hostname);
  for (const platform of PLATFORMS) {
    if (host.endsWith(`.${platform.suffix}`)) return platform;
  }
  return null;
}

export function isPlatformSubdomain(hostname: string): boolean {
  return platformOf(hostname) !== null;
}

/**
 * The name whose mail and zone records speak for `hostname`: its registrable
 * domain, `www.` stripped. `www.fastmail.com` has no MX, DKIM selector or SPF
 * of its own, and judging it as if it were the mail domain reported all three
 * missing while `fastmail.com` publishes them.
 *
 * Falls back to the hostname itself when climbing would land on a single
 * label or on an address, so a bare label or an IP is never turned into
 * something a resolver would read as a TLD.
 */
export function mailDomainFor(hostname: string): string {
  const host = normalise(hostname);
  if (host.includes(":") || isIP(host) !== 0) return host;
  const root = extractRootDomain(host);
  return root.split(".").length >= 2 ? root : host;
}
