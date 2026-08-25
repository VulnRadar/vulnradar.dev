"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "@/components/docs/docs-shell";
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
      type: "number",
      required: true,
      description:
        "Scan (scan_history) id, the same id used by GET /history/{id}",
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
    "A Bearer request counts against that key's daily rate limit and is recorded as usage; a session request does not.",
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
        "Bearer key is missing the scan:read scope, or Terms of Service are unaccepted",
    },
    { code: 404, description: "Scan not found, or not visible to this caller" },
    { code: 429, description: "API key daily rate limit exceeded" },
  ],
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
  const { setActiveSection, setTocItems } = useDocsContext();
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setTocItems(tocItems);
    return () => setTocItems([]);
  }, [setTocItems]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    tocItems.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observerRef.current?.observe(el);
    });
    return () => observerRef.current?.disconnect();
  }, [setActiveSection]);

  return (
    <div className="space-y-16">
      <DocsHero
        id="top"
        badge="Reporting"
        title="Reports & Compliance"
        description={`Every completed scan can be pulled back out as SARIF, PDF, Markdown, raw JSON, or a compliance crosswalk. One endpoint, one query param, the same auth as the scan itself. Point it at CI to gate a build, hand a PDF to a stakeholder, or generate an auditor-facing control summary from the same findings.`}
        stats={[
          { value: "5", label: "Export formats" },
          { value: "6", label: "Compliance frameworks" },
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
            <strong className="text-foreground">
              Bearer usage is metered:
            </strong>{" "}
            a key request counts against that key&apos;s daily rate limit and is
            recorded as usage; a <InlineCode>429</InlineCode> means the key is
            out of quota for the day. Session requests are not metered this way.
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
            data={[
              {
                framework: "PCI DSS 4.0",
                refs: "Requirement numbers (e.g. 6.2.4, 4.2.1)",
                meaning:
                  "The requirements a finding is relevant to, not an assessed pass or fail.",
              },
              {
                framework: "SOC 2 (Trust Services Criteria)",
                refs: "2017 Common Criteria, CC series (e.g. CC6.1)",
                meaning:
                  "The Common Criteria a Type II audit would gather evidence against.",
              },
              {
                framework: "ISO/IEC 27001:2022",
                refs: "Annex A controls (e.g. A.8.28)",
                meaning:
                  "The finding is in scope for that control, not that the control is implemented or broken.",
              },
              {
                framework: "OWASP ASVS 4.0",
                refs: "Verification chapters V1 to V14 (e.g. V5)",
                meaning:
                  "The verification requirements that cover this class of finding.",
              },
              {
                framework: "HIPAA Security Rule",
                refs: "45 CFR Part 164 safeguards (e.g. 164.312(e)(1))",
                meaning:
                  "The technical or administrative safeguard a finding touches. An external scan cannot judge policies, BAAs, or physical safeguards.",
              },
              {
                framework: "GDPR (Art. 32)",
                refs: "Security-of-processing articles (e.g. 32(1)(a))",
                meaning:
                  "The security obligation a finding touches, not lawful basis or data-subject rights.",
              },
            ]}
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
