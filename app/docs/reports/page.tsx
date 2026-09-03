import Link from "next/link";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import {
  FRAMEWORKS,
  type FrameworkKey,
} from "@/lib/reports/compliance-mappings";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  DocsTable,
  EndpointCard,
  CodeBlock,
  InlineCode,
  type Endpoint,
} from "@/components/docs";

const reportEndpoint: Endpoint = {
  id: "endpoint",
  method: "GET",
  path: "/history/{id}/report",
  title: "Export a Scan Report",
  description:
    "Generate a report over a completed scan in the format you ask for. The generators are the same pure functions the in-app export menu runs client-side; this route exposes them so CI and API consumers can pull a SARIF file, a PDF, a Markdown report, or the compliance crosswalk without a browser. Nothing is stored: the report is built on demand from the scan row.",
  pathParams: [
    {
      name: "id",
      type: "string",
      required: true,
      description:
        "The opaque scan id GET /history returns, the same id GET /history/{id} takes. The legacy integer id still resolves.",
    },
  ],
  queryParams: [
    {
      name: "format",
      type: "string",
      description:
        "json (default) | sarif | pdf | md (alias markdown) | compliance",
      default: "json",
    },
  ],
  responseExample: `// format=sarif  ->  Content-Type: application/sarif+json
{
  "$schema": "https://.../sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "${APP_NAME}",
          "version": "3.x",
          "rules": [ /* one entry per unique check id */ ]
        }
      },
      "results": [
        {
          "ruleId": "hsts-missing",
          "level": "warning",
          "message": { "text": "HSTS header missing. Evidence: ..." },
          "partialFingerprints": { "vulnradarFindingId": "hsts-missing" },
          "properties": { "severity": "medium", "category": "headers" }
        }
      ]
    }
  ]
}`,
  notes: [
    "format is case-insensitive and defaults to json. Anything outside json | sarif | pdf | md | markdown | compliance returns 400.",
    'Content-Type and download name track the format: application/sarif+json (.sarif), application/pdf (.pdf), text/markdown (.md, and -compliance.md for the crosswalk), application/json (.json). Every response sets Content-Disposition: attachment; filename="vulnradar-<host>.<ext>", where <host> is the scanned URL\'s hostname.',
    "Same auth and visibility as GET /history/{id}: a Bearer key with the scan:read scope, or a session cookie; the scan's owner or a team member with read access.",
    "The owner's report carries cross-rescan remediation status on each finding; a team-read viewer gets the stored findings as-is, because remediation state is private to the owner.",
    "Both auth paths are throttled, just by different limiters. A Bearer request spends one of that key's daily requests and is recorded as usage. A session request spends from a per-user report-export bucket on the general API budget, because every format is built synchronously over the whole findings array and a signed-in user looping their largest export could otherwise stall the single Node process for everyone.",
    "format=pdf can be switched off per deployment (FEATURE_PDF_REPORTS). When it is off the route answers 403 before it looks the scan up; the other four formats are unaffected.",
  ],
  errors: [
    { code: 400, description: "Unsupported format value" },
    {
      code: 401,
      description:
        "No session cookie or Bearer key, or the key is invalid or revoked",
    },
    {
      code: 403,
      description:
        "Bearer key is missing the scan:read scope, Terms of Service are unaccepted, or format=pdf on a deployment with PDF reports disabled",
    },
    { code: 404, description: "Scan not found, or not visible to this caller" },
    {
      code: 429,
      description:
        "API key daily limit reached, or too many session-authenticated exports (Retry-After says how long)",
    },
  ],
};

/**
 * Per-framework prose for the crosswalk table. Keyed by FrameworkKey so
 * adding a framework to FRAMEWORKS is a type error here until this page
 * describes it, rather than a row that silently goes missing.
 */
const FRAMEWORK_REFS: Record<FrameworkKey, string> = {
  pci: "Requirement numbers (e.g. 6.2.4, 4.2.1)",
  soc2: "2017 Common Criteria, CC series (e.g. CC6.1)",
  iso27001: "Annex A controls (e.g. A.8.28)",
  asvs: "Verification chapters V1 to V14 (e.g. V5)",
  hipaa: "45 CFR Part 164 safeguards (e.g. 164.312(e)(1))",
  gdpr: "Security-of-processing articles (e.g. 32(1)(a))",
};

const FRAMEWORK_MEANINGS: Record<FrameworkKey, string> = {
  pci: "The requirements a finding is relevant to, not an assessed pass or fail.",
  soc2: "The Common Criteria a Type II audit would gather evidence against.",
  iso27001:
    "The finding is in scope for that control, not that the control is implemented or broken.",
  asvs: "The verification requirements that cover this class of finding.",
  hipaa:
    "The technical or administrative safeguard a finding touches. An external scan cannot judge policies, BAAs, or physical safeguards.",
  gdpr: "The security obligation a finding touches, not lawful basis or data-subject rights.",
};

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "endpoint", label: "The report endpoint" },
  { id: "formats", label: "Report formats" },
  { id: "access", label: "Access control" },
  { id: "sarif", label: "SARIF and CI" },
  { id: "compliance", label: "Compliance crosswalk" },
  { id: "caveats", label: "What the crosswalk is not" },
];

export default function ReportsDocsPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Reporting"
        title="Reports & Compliance"
        description={`Every completed scan can be pulled back out as SARIF, PDF, Markdown, raw JSON, or a compliance crosswalk. One endpoint, one query param, the same auth as the scan itself. Point it at CI to gate a build, hand a PDF to a stakeholder, or generate an auditor-facing control summary from the same findings.`}
        stats={[
          { value: "5", label: "Export formats" },
          {
            value: String(FRAMEWORKS.length),
            label: "Compliance frameworks",
          },
          { value: "scan:read", label: "API key scope" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <div className="max-w-[68ch] space-y-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          <p>
            {APP_NAME} stores each scan once and renders reports from it on
            demand. The in-app export menu on a scan runs the report generators
            client-side; the same generators are exposed over one HTTP endpoint
            so a pipeline or a script can fetch the exact same output with a
            Bearer key. There is no separate &quot;report&quot; object to create
            or poll: you already have a scan id, so you already have every
            report.
          </p>
          <p>
            The endpoint lives under <InlineCode>{APP_URL}/api/v3/</InlineCode>{" "}
            like the rest of the{" "}
            <Link
              href="/docs/api"
              className="text-primary underline-offset-2 hover:underline"
            >
              v3 API
            </Link>
            . Pick a format with the <InlineCode>format</InlineCode> query
            parameter; the response is a file download, not a JSON envelope, so
            pipe it to a file or hand it straight to whatever consumes it.
          </p>
        </div>
      </DocsSection>

      <DocsSection id="endpoint" title="The report endpoint">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          One GET, authenticated exactly like{" "}
          <InlineCode>GET /history/{"{id}"}</InlineCode>. The{" "}
          <InlineCode>format</InlineCode> parameter selects the generator; the
          response headers tell you what came back.
        </p>
        <EndpointCard {...reportEndpoint} />
      </DocsSection>

      <DocsSection id="formats" title="Report formats">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Five outputs off the one endpoint. <InlineCode>md</InlineCode> and{" "}
          <InlineCode>markdown</InlineCode> are the same generator under two
          names; everything else is distinct.
        </p>

        <DocsTable
          caption="Report formats, their content types, and when to reach for each"
          columns={[
            { key: "format", header: "format", className: "font-mono" },
            {
              key: "contentType",
              header: "Content-Type",
              className: "font-mono",
            },
            { key: "whenToUse", header: "When to use it", className: "w-full" },
          ]}
          data={[
            {
              format: "sarif",
              contentType: "application/sarif+json",
              whenToUse:
                "Upload to GitHub Code Scanning so findings show up as annotated alerts on the Security tab instead of a report nobody opens.",
            },
            {
              format: "pdf",
              contentType: "application/pdf",
              whenToUse:
                "A branded, self-contained report to hand to a stakeholder or client who will not open a terminal.",
            },
            {
              format: "md",
              contentType: "text/markdown",
              whenToUse:
                "Paste into a pull request, an issue, a wiki, or a chat message. Renders as a readable severity-ordered report.",
            },
            {
              format: "compliance",
              contentType: "text/markdown",
              whenToUse:
                "The control crosswalk below, as a Markdown summary for an auditor or GRC reviewer to prioritise remediation.",
            },
            {
              format: "json",
              contentType: "application/json",
              whenToUse:
                "The raw ScanResult (findings, summary, response headers, metadata) when you would rather parse it yourself. This is the default.",
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="access" title="Access control">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The report inherits the scan&apos;s access model, so there is nothing
          new to authorise. A caller who can read the scan can pull any format
          of its report; a caller who cannot gets the same{" "}
          <InlineCode>404</InlineCode> the scan itself returns.
        </p>

        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">
              Two ways to authenticate:
            </strong>{" "}
            a Bearer API key that holds the <InlineCode>scan:read</InlineCode>{" "}
            scope, or the session cookie the web app already has. A key without{" "}
            <InlineCode>scan:read</InlineCode> gets <InlineCode>403</InlineCode>
            .
          </li>
          <li>
            <strong className="text-foreground">Owner or team read:</strong> the
            scan&apos;s owner always has access. A teammate has access when the
            team&apos;s resource-access check grants read on that scan. Anyone
            else, including a valid key on an unrelated account, gets{" "}
            <InlineCode>404</InlineCode>, not <InlineCode>403</InlineCode>, so
            the endpoint never confirms a scan exists to someone who cannot see
            it.
          </li>
          <li>
            <strong className="text-foreground">
              Remediation status is private:
            </strong>{" "}
            the owner&apos;s report attaches cross-rescan remediation state to
            each finding (fixed, still open, and so on). A team-read viewer sees
            the stored findings as they were captured, without that private
            layer.
          </li>
          <li>
            <strong className="text-foreground">Both paths are metered:</strong>{" "}
            a key request counts against that key&apos;s daily rate limit and is
            recorded as usage, so a <InlineCode>429</InlineCode> there means the
            key is out of quota for the day. A session request is not free
            either: it draws on a separate per-user report-export bucket and
            gets its own <InlineCode>429</InlineCode> with a{" "}
            <InlineCode>Retry-After</InlineCode> when you exhaust it. Every
            format is generated synchronously over the whole findings array, so
            an unmetered session path was a way to pin the process.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="sarif" title="SARIF and CI">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          SARIF is the format worth wiring up first. The export is SARIF 2.1.0,
          the JSON schema GitHub Code Scanning consumes natively. Critical and
          high map to <InlineCode>level: error</InlineCode>, medium to{" "}
          <InlineCode>warning</InlineCode>, low and info to{" "}
          <InlineCode>note</InlineCode>. Each result carries a{" "}
          <InlineCode>partialFingerprints.vulnradarFindingId</InlineCode> equal
          to the stable check id, so re-running the scan updates the same alert
          instead of opening a duplicate. When a finding has a real computed
          CVSS score it is exported as{" "}
          <InlineCode>security-severity</InlineCode>; otherwise a per-band
          default is used.
        </p>

        <DocsSubSection title="Fetch a SARIF report with curl">
          <CodeBlock
            code={`curl -sS "${APP_URL}/api/v3/history/123/report?format=sarif" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY" \\
  -o vulnradar.sarif`}
            language="bash"
          />
        </DocsSubSection>

        <DocsSubSection title="Upload it to GitHub Code Scanning">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Store the key as a repo secret, fetch the SARIF for a completed
            scan, then hand it to the official upload action. The findings
            appear on the Security tab, annotated against the target.
          </p>
          <CodeBlock
            code={`- name: Fetch VulnRadar SARIF
  run: |
    curl -sS "${APP_URL}/api/v3/history/\${{ needs.scan.outputs.scan-id }}/report?format=sarif" \\
      -H "Authorization: Bearer \${{ secrets.VULNRADAR_TOKEN }}" \\
      -o vulnradar.sarif

- name: Upload to code scanning
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: vulnradar.sarif`}
            language="yaml"
          />
          <DocsCallout
            variant="info"
            title="You need a completed scan id first"
          >
            <p>
              This endpoint reports on a scan that already ran. Start one with{" "}
              <InlineCode>POST /scan</InlineCode>, poll{" "}
              <InlineCode>GET /scan/status/{"{id}"}</InlineCode> until it is{" "}
              <InlineCode>completed</InlineCode>, then feed that id here. See
              the{" "}
              <Link
                href="/docs/api"
                className="text-primary underline-offset-2 hover:underline"
              >
                API reference
              </Link>{" "}
              for the scan and polling flow.
            </p>
          </DocsCallout>
        </DocsSubSection>

        <DocsSubSection title="Import into DefectDojo or Faraday">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            The same SARIF file imports into the two open-source vulnerability
            managers without any {APP_NAME}-specific plumbing. DefectDojo parses
            it under the built-in <InlineCode>SARIF</InlineCode> scan type, so
            findings land beside whatever else you already aggregate there.
            Point <InlineCode>DD_URL</InlineCode> at your instance and use an
            API v2 token.
          </p>
          <CodeBlock
            code={`curl -sS "${APP_URL}/api/v3/history/123/report?format=sarif" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY" \\
  -o vulnradar.sarif

curl -sS -X POST "$DD_URL/api/v2/import-scan/" \\
  -H "Authorization: Token $DD_TOKEN" \\
  -F "scan_type=SARIF" \\
  -F "engagement=$DD_ENGAGEMENT_ID" \\
  -F "file=@vulnradar.sarif"`}
            language="bash"
          />
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Faraday reads SARIF too, through{" "}
            <InlineCode>faraday-cli</InlineCode>:{" "}
            <InlineCode>
              faraday-cli tool report vulnradar.sarif --plugin-id sarif
            </InlineCode>
            . Use <InlineCode>--workspace</InlineCode> to pick the target
            workspace.
          </p>
          <DocsCallout variant="info" title="Re-imports deduplicate">
            <p>
              Both tools key on the SARIF{" "}
              <InlineCode>partialFingerprints</InlineCode> described above, so
              importing a later scan of the same target updates the existing
              findings and closes the ones that are gone, rather than piling up
              duplicates. Import on a schedule and the manager shows the trend
              on its own.
            </p>
          </DocsCallout>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="compliance" title="Compliance crosswalk">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The <InlineCode>compliance</InlineCode> format expresses each finding
          as the framework controls it touches, so an engineer or a GRC reviewer
          can see &quot;these findings are relevant to PCI requirement
          6.2.4&quot; without hand-mapping every result. The output is Markdown:
          a disclaimer, an overview, one section per framework grouped by
          control, an explicit list of findings that did not map to anything,
          and a short note on how the mapping is derived.
        </p>

        <DocsSubSection title="Frameworks covered">
          {/* Names and count come from FRAMEWORKS, the same array the report
              generator loops over to build its sections, so this table cannot
              list a framework the report does not emit (or miss one it does).
              The example references stay hand-written: they are illustrative,
              not the full control catalog. */}
          <DocsTable
            caption="Compliance frameworks in the crosswalk and what a mapping to each means"
            columns={[
              { key: "framework", header: "Framework" },
              { key: "refs", header: "References", className: "w-[38%]" },
              {
                key: "meaning",
                header: "What a mapping means",
                className: "w-full",
              },
            ]}
            data={FRAMEWORKS.map((framework) => ({
              framework: framework.name,
              refs: FRAMEWORK_REFS[framework.key],
              meaning: FRAMEWORK_MEANINGS[framework.key],
            }))}
          />
        </DocsSubSection>

        <DocsSubSection title="How a finding resolves to controls">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Every finding is routed through its OWASP Top 10 (2021) category
            first, then to the controls each framework uses to govern that class
            of weakness. That routing is the vetted backbone; the frameworks all
            hang off it.
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-sm leading-relaxed text-muted-foreground marker:text-primary">
            <li>
              If the check tagged the finding with an OWASP category, that tag
              is used.
            </li>
            <li>
              Its CWE id, if present, is run through a CWE to OWASP crosswalk.
              Both the tag and the CWE can contribute, and the resulting
              categories are deduplicated.
            </li>
            <li>
              Only if neither yields a category does a coarse scanner-category
              fallback apply (for example <InlineCode>headers</InlineCode> and{" "}
              <InlineCode>cookies</InlineCode> to A05 Security
              Misconfiguration).
            </li>
            <li>
              Each resolved OWASP category expands to its PCI, SOC 2, ISO 27001,
              ASVS, HIPAA, and GDPR control references, deduplicated across
              every category the finding matched.
            </li>
          </ol>
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            A finding that resolves to no category is not dropped: it lands in
            the report&apos;s{" "}
            <strong className="text-foreground">Unmapped findings</strong>{" "}
            section. DNS, email, and reputation findings live there by design,
            because those classes do not map cleanly onto these web-application
            frameworks and force-fitting them would be dishonest.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Fetch the compliance report">
          <CodeBlock
            code={`curl -sS "${APP_URL}/api/v3/history/123/report?format=compliance" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY" \\
  -o vulnradar-compliance.md`}
            language="bash"
          />
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="caveats" title="What the crosswalk is not">
        <DocsCallout
          variant="warning"
          title="Guidance, not a compliance determination"
        >
          <p>
            The crosswalk is indicative. It points an engineer or a reviewer at
            the requirements a finding is relevant to; it does not make a site
            compliant and it is not an audit, certification, or attestation. The
            report says exactly this in a disclaimer at the top of its output.
          </p>
        </DocsCallout>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            A scan observes a target from the outside. It cannot see your
            policies, processes, evidence, or audit scope, and those are what a
            real assessment evaluates.
          </li>
          <li>
            A mapping to a control means a finding is in scope for it, never
            that the control passed or failed.
          </li>
          <li>
            Certification or attestation has to come from a qualified assessor:
            a PCI QSA, a licensed CPA firm for SOC 2, or an accredited ISO 27001
            certification body.
          </li>
          <li>
            HIPAA and GDPR mappings only reach the technical safeguard and
            security-of-processing parts of those regimes, never their policy,
            process, or data-subject-rights scope.
          </li>
        </ul>
      </DocsSection>
    </div>
  );
}
