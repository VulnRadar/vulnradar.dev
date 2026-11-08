import Link from "next/link";

import { APP_NAME } from "@/lib/config/constants";
import { COMMON_PORT_COUNT } from "@/lib/scanner/port-scan";
import { MAX_SPEC_TARGETS } from "@/lib/scanner/spec-import";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  DocsTable,
  InlineCode,
} from "@/components/docs";

const LINK = "text-primary underline-offset-2 hover:underline";

const tocItems: TocItem[] = [
  { id: "modes", label: "Quick, Deep and Bulk" },
  { id: "options", label: "Options on the scan form" },
  { id: "panels", label: "What the result panels show" },
  { id: "authentication", label: "Scanning behind a login" },
  { id: "spec-import", label: "Importing targets from an API spec" },
];

const SCAN_MODES = [
  {
    mode: "Quick",
    does: "Scans the one page you enter with every check family you left on. The default.",
    limit: "Scans per day",
  },
  {
    mode: "Deep",
    does: "Crawls the site first and lists the pages it found, and you pick which ones to scan. Only pages you pick are scanned.",
    limit: "Pages one crawl may scan",
  },
  {
    mode: "Bulk",
    does: "Takes a list with one full URL per line and scans each one separately, so each gets its own entry in your history.",
    limit: "URLs per bulk scan",
  },
];

export default function ScanningDocsPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Scanning"
        title="Scanning a Site"
        description={`What the scan form does before you press Scan and what comes back after. The form sits at the top of the dashboard: paste a domain, a URL or an IPv4 address, pick a mode, and turn on anything extra. ${APP_NAME} reads the target from the outside, so there is no agent to install.`}
        stats={[
          { value: String(SCAN_MODES.length), label: "Scan modes" },
          {
            value: String(COMMON_PORT_COUNT),
            label: "Ports in the optional sweep",
          },
          {
            value: String(MAX_SPEC_TARGETS),
            label: "Targets from one API spec",
          },
        ]}
      />

      <DocsSection id="modes" title="Quick, Deep and Bulk">
        <DocsTable
          caption="The three scan modes, what each one does, and the plan limit that applies"
          columns={[
            { key: "mode", header: "Mode" },
            { key: "does", header: "What it does", className: "w-full" },
            { key: "limit", header: "Plan limit" },
          ]}
          data={SCAN_MODES}
        />
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The numbers for each limit are on{" "}
          <Link href="/docs/billing#plans" className={LINK}>
            Plans and Billing
          </Link>
          . Every URL in a Deep or Bulk scan uses the same engine as a Quick
          scan. If a scan fails or comes back empty, start with{" "}
          <Link href="/docs/troubleshooting" className={LINK}>
            Troubleshooting Scans
          </Link>
          ; once you have findings,{" "}
          <Link href="/docs/triage" className={LINK}>
            Triage &amp; Remediation
          </Link>{" "}
          is what happens next.
        </p>
      </DocsSection>

      <DocsSection id="options" title="Options on the scan form">
        <ul className="list-disc space-y-2 pl-6 text-sm leading-relaxed text-muted-foreground">
          <li>
            <strong className="text-foreground">Check families</strong> narrow
            what runs. All of them are on by default, and the report says how
            many checks ran, so a narrowed scan is visible as one.
          </li>
          <li>
            <strong className="text-foreground">Active probing</strong> sends
            real requests that write to the target, so it is off by default and
            needs a{" "}
            <Link href="/docs/sharing#domain-owner-controls" className={LINK}>
              verified domain
            </Link>
            .
          </li>
          <li>
            <strong className="text-foreground">Scan common ports</strong>{" "}
            sweeps {COMMON_PORT_COUNT} well-known ports. It also needs a
            verified domain, and only runs on Quick and Deep.
          </li>
          <li>
            <strong className="text-foreground">Capture page screenshot</strong>{" "}
            opens a real browser once and uses your live-browser minutes. Quick
            and Deep only.
          </li>
          <li>
            <strong className="text-foreground">Keep this scan private</strong>{" "}
            overrides your account default for this scan. Left off on a public
            account, the findings go to the public{" "}
            <Link href="/docs/sharing#who-can-see" className={LINK}>
              host page
            </Link>
            .
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="panels" title="What the result panels show">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The findings list is the report. The panels around it are the evidence
          about the host, and a panel with nothing to show does not appear.
        </p>
        <DocsTable
          caption="Each result panel, what it shows, and where its data comes from"
          columns={[
            { key: "panel", header: "Panel" },
            { key: "shows", header: "What it shows" },
            {
              key: "source",
              header: "Where it comes from",
              className: "w-[45%]",
            },
          ]}
          data={[
            {
              panel: "Summary",
              shows:
                "The rating, risk score, severity counts and engine confidence",
              source:
                "Worked out from this scan's own findings and how many checks completed.",
            },
            {
              panel: "Screenshot",
              shows: "An image of the page",
              source: "A real browser session, only when you asked for one.",
            },
            {
              panel: "Response headers",
              shows: "The headers the page answered with",
              source: "The scan's page fetch.",
            },
            {
              panel: "DNS records",
              shows: "The records published for the host",
              source: "DNS lookups made during the scan.",
            },
            {
              panel: "Ports",
              shows: "Which services answered, and any version they gave away",
              source: `The optional TCP sweep of ${COMMON_PORT_COUNT} ports.`,
            },
            {
              panel: "Threat intelligence",
              shows: "What each reputation source said about the host",
              source:
                "Third-party reputation lookups during the scan. A source that could not be reached is shown as unavailable, never as clean.",
            },
            {
              panel: "Software inventory",
              shows:
                "Server, framework, CDN, analytics and client libraries, with known CVEs per version",
              source:
                "Fingerprints in the response, matched against OSV.dev and the NVD and enriched with CISA KEV and FIRST.org EPSS.",
            },
            {
              panel: "Subdomains",
              shows: "Hostnames found under the domain",
              source: "A separate discovery run over passive public sources.",
            },
            {
              panel: "Look this up elsewhere",
              shows: "Links to third-party analysis services",
              source:
                "Nothing is fetched or stored. Each one is a link your own browser follows.",
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="authentication" title="Scanning behind a login">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Open <strong className="text-foreground">Sign in first</strong> on the
          scan form to scan a page as a logged-in user. Login details are used
          for that one scan and never stored: the form clears them the moment
          you submit. The result can include what only a logged-in user sees, so
          adding a login turns on{" "}
          <strong className="text-foreground">Keep this scan private</strong>{" "}
          whatever your account default is. Turn it off yourself only if you
          mean to publish the result.
        </p>
        <DocsTable
          caption="The three ways to sign in and whether each needs a verified domain"
          columns={[
            { key: "method", header: "Method" },
            { key: "what", header: "What you give it", className: "w-full" },
            { key: "verified", header: "Verified domain" },
          ]}
          data={[
            {
              method: "Form login",
              what: "A username and password, which the scanner submits to the target's own login page.",
              verified: "Required",
            },
            {
              method: "Header / token",
              what: "One request header, such as Authorization, sent with every request.",
              verified: "Not required",
            },
            {
              method: "Cookie",
              what: "One or more session cookies you copied from a signed-in browser.",
              verified: "Not required",
            },
          ]}
        />
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A signed-in Quick scan does not take a screenshot or sweep ports,
          because the authenticated scan path has neither.
        </p>
      </DocsSection>

      <DocsSection id="spec-import" title="Importing targets from an API spec">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          On the Bulk tab,{" "}
          <strong className="text-foreground">Import spec</strong> reads an
          OpenAPI 3, Swagger 2 or Postman collection and adds the URLs it
          declares to your list. They are merged in, so you can import more than
          one spec or add URLs by hand, and you still press Scan yourself.
        </p>
        <ul className="list-disc space-y-2 pl-6 text-sm leading-relaxed text-muted-foreground">
          <li>
            The file must be JSON and at most 5 MB. Convert a YAML spec first.
          </li>
          <li>
            One spec yields at most {MAX_SPEC_TARGETS} targets, after removing
            duplicates.
          </li>
          <li>
            It needs at least one absolute <InlineCode>http(s)</InlineCode>{" "}
            server or base URL. A spec with only relative paths has nothing to
            scan.
          </li>
          <li>
            A templated path like <InlineCode>/users/{"{id}"}</InlineCode> is
            filled from the parameter&apos;s own example, default or enum value.
            If the spec declares none, that path is dropped rather than guessed.
          </li>
        </ul>
        <DocsCallout variant="info" title="The Bulk limit still applies">
          <p>
            Imported URLs land in the same list as ones you typed, so your
            plan&apos;s URLs per bulk scan is the real ceiling on how many run.
            Trim the list if an import takes you over it.
          </p>
        </DocsCallout>
      </DocsSection>
    </div>
  );
}
