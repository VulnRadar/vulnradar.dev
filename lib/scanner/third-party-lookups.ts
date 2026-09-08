/**
 * Deep links to third-party reputation and analysis services.
 *
 * The point of this module is what it does NOT do. It builds URLs. It sends no
 * request, holds no API key, and stores nothing about a lookup: the reader
 * clicks and their own browser goes to VirusTotal, so the scan target never
 * passes through our servers on the way there and there is no record here that
 * anyone looked.
 *
 * That matters for three separate reasons and only one of them is cost.
 * VirusTotal's own API is a paid product at any useful rate, and we would be
 * paying for lookups on behalf of anyone who pastes a URL. Beyond that: an API
 * key here would mean every user's targets are submitted under our account,
 * which is a real privacy transfer nobody agreed to, and a stored verdict is a
 * cached opinion about somebody's site that goes stale and gets served as
 * though it were current. A link has none of those properties. It is also
 * honest about where the answer comes from, which a copied verdict is not.
 *
 * Every builder here is a pure function of the target. Adding a service means
 * adding one entry.
 */

/** What the service wants to be handed. */
type LookupSubject = "url" | "host" | "domain";

export interface LookupService {
  id: string;
  name: string;
  /** One line, shown under the name. Say what the reader will find there. */
  description: string;
  /**
   * How the service is useful, which decides where it sits in the list.
   *
   * "reputation" answers whether anyone has flagged this target.
   * "infrastructure" answers what is behind it: DNS, hosting, certificates.
   * "assessment" runs its own test and grades the result.
   * "history" shows what the target used to be.
   */
  group: "reputation" | "infrastructure" | "assessment" | "history";
  subject: LookupSubject;
  /**
   * True when the service will fetch the target itself on arrival.
   *
   * The reader should know before they click: an assessment tool visits the
   * site, which shows up in that site's logs as traffic the reader caused.
   * That is fine on your own property and rude on somebody else's.
   */
  visitsTarget?: boolean;
  build(subject: string): string;
}

/**
 * The registrable domain, approximately.
 *
 * Deliberately not a public-suffix list: pulling one in for a link builder
 * would add a megabyte of data that needs updating, to make a link slightly
 * tidier. The two-label fallback is wrong for co.uk and its relatives, which
 * is why the services that want a domain are the ones where an over-broad
 * subject is harmless (crt.sh on example.co.uk still finds the right certs).
 */
function registrableDomain(hostname: string): string {
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length <= 2) return hostname;
  const MULTI_PART_TLD =
    /^(?:co|com|net|org|gov|edu|ac|mil|or|ne|go|in)\.[a-z]{2}$/i;
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_PART_TLD.test(lastTwo)
    ? labels.slice(-3).join(".")
    : labels.slice(-2).join(".");
}

export const LOOKUP_SERVICES: readonly LookupService[] = [
  {
    id: "virustotal",
    name: "VirusTotal",
    description:
      "Around seventy antivirus engines and blocklist feeds, and whatever anyone else has already submitted about this address.",
    group: "reputation",
    subject: "url",
    build: (url) =>
      `https://www.virustotal.com/gui/search?query=${encodeURIComponent(url)}`,
  },
  {
    id: "urlscan",
    name: "urlscan.io",
    description:
      "Existing public scans of this address: what it loaded, who it talked to, and what it looked like at the time.",
    group: "reputation",
    subject: "url",
    build: (url) =>
      `https://urlscan.io/search/#${encodeURIComponent(`page.url:"${url}"`)}`,
  },
  {
    id: "google-safe-browsing",
    name: "Google Safe Browsing",
    description:
      "Whether Chrome, Safari and Firefox would show an interstitial before letting somebody through to this site.",
    group: "reputation",
    subject: "host",
    build: (host) =>
      `https://transparencyreport.google.com/safe-browsing/search?url=${encodeURIComponent(host)}`,
  },
  {
    id: "cloudflare-radar",
    name: "Cloudflare Radar",
    description:
      "Cloudflare's own view of the domain: traffic ranking, its security categories, and current DNS.",
    group: "reputation",
    subject: "domain",
    build: (domain) => `https://radar.cloudflare.com/domains/domain/${domain}`,
  },
  {
    id: "shodan",
    name: "Shodan",
    description:
      "Every service Shodan has found listening on this host's addresses, with the banners it read.",
    group: "infrastructure",
    subject: "host",
    build: (host) =>
      `https://www.shodan.io/search?query=${encodeURIComponent(`hostname:${host}`)}`,
  },
  {
    id: "crtsh",
    name: "crt.sh",
    description:
      "Every certificate ever issued for this domain, from the public Certificate Transparency logs. The fastest way to find subdomains nobody meant to publish.",
    group: "infrastructure",
    subject: "domain",
    build: (domain) => `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}`,
  },
  {
    id: "dnsviz",
    name: "DNSViz",
    description:
      "The DNSSEC chain drawn out, node by node, which is the only readable way to see where a broken one breaks.",
    group: "infrastructure",
    subject: "domain",
    build: (domain) => `https://dnsviz.net/d/${domain}/analyze`,
    visitsTarget: true,
  },
  {
    id: "bgpview",
    name: "BGP.tools",
    description:
      "Which network actually announces this host's addresses, and who else lives on it.",
    group: "infrastructure",
    subject: "host",
    build: (host) => `https://bgp.tools/dns/${host}`,
  },
  {
    id: "ssllabs",
    name: "SSL Labs",
    description:
      "A full TLS assessment, graded A+ through F, covering the cipher and protocol negotiation our own check summarises.",
    group: "assessment",
    subject: "host",
    build: (host) =>
      `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(host)}&hideResults=on`,
    visitsTarget: true,
  },
  {
    id: "mozilla-observatory",
    name: "Mozilla HTTP Observatory",
    description:
      "Mozilla's own header grade, worth comparing against ours: where the two disagree is usually where a judgement call was made.",
    group: "assessment",
    subject: "host",
    build: (host) =>
      `https://developer.mozilla.org/en-US/observatory/analyze?host=${encodeURIComponent(host)}`,
    visitsTarget: true,
  },
  {
    id: "hardenize",
    name: "Hardenize",
    description:
      "Web, email and DNS configuration side by side, including the MTA-STS and DANE parts most tools skip.",
    group: "assessment",
    subject: "domain",
    build: (domain) => `https://www.hardenize.com/report/${domain}`,
    visitsTarget: true,
  },
  {
    id: "mxtoolbox",
    name: "MXToolbox",
    description:
      "Mail delivery from the receiving side: MX, SPF, DMARC, and the blacklists that decide whether this domain's mail arrives.",
    group: "assessment",
    subject: "domain",
    build: (domain) =>
      `https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${encodeURIComponent(domain)}&run=toolpage`,
    visitsTarget: true,
  },
  {
    id: "wayback",
    name: "Wayback Machine",
    description:
      "What this address served in the past, which is how you find the admin panel that used to be linked from the footer.",
    group: "history",
    subject: "url",
    build: (url) => `https://web.archive.org/web/*/${url}`,
  },
  {
    id: "securitytrails",
    name: "SecurityTrails",
    description:
      "Historical DNS: the addresses this domain used to point at, which often still answer.",
    group: "history",
    subject: "domain",
    build: (domain) => `https://securitytrails.com/domain/${domain}/dns`,
  },
];

export interface ResolvedLookup extends LookupService {
  href: string;
}

/**
 * Every lookup for a scanned URL, or an empty list when the target is not
 * something a third party could look up.
 *
 * A private or non-routable target is excluded deliberately rather than
 * incidentally: sending http://192.168.1.1/admin to VirusTotal's search box
 * publishes an internal address to a third party, and it does it as a side
 * effect of the reader clicking a link that could not have told them anything
 * anyway. The same applies to a scan of localhost during self-hosted setup.
 */
export function resolveLookups(rawUrl: string): ResolvedLookup[] {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return [];
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || !host.includes(".")) return [];
  // An IP literal has no domain to look up and is usually an internal target.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return [];
  if (isPrivateHost(host)) return [];

  const domain = registrableDomain(host);
  const subjects: Record<LookupSubject, string> = {
    url: parsed.href,
    host,
    domain,
  };

  return LOOKUP_SERVICES.map((service) => ({
    ...service,
    href: service.build(subjects[service.subject]),
  }));
}

/** A hostname no third party could resolve, or one that names a local network. */
function isPrivateHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example")
  );
}

/** Section headings, in the order the panel renders them. */
export const LOOKUP_GROUPS: {
  id: LookupService["group"];
  label: string;
  blurb: string;
}[] = [
  {
    id: "reputation",
    label: "Reputation",
    blurb: "Has anyone else already flagged this address.",
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    blurb: "What is behind it: addresses, certificates, DNS.",
  },
  {
    id: "assessment",
    label: "Second opinions",
    blurb: "Tools that run their own test and grade the result.",
  },
  {
    id: "history",
    label: "History",
    blurb: "What this address used to be.",
  },
];
