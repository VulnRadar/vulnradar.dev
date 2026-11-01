import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  DocsTable,
  CodeBlock,
  InlineCode,
} from "@/components/docs";
import {
  API_VERSION,
  APP_NAME,
  APP_REPO,
  APP_URL,
} from "@/lib/config/constants";
import {
  CONFIG_BILLING_FREE_CRAWL_PAGES,
  CONFIG_BILLING_CORE_SUPPORTER_CRAWL_PAGES,
  CONFIG_BILLING_PRO_SUPPORTER_CRAWL_PAGES,
  CONFIG_BILLING_ELITE_SUPPORTER_CRAWL_PAGES,
  CONFIG_SCAN_TIMEOUT_SECONDS,
  CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS,
} from "@/lib/config/config-values";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "install", label: "Install" },
  { id: "usage", label: "Usage" },
  { id: "options", label: "Options" },
  { id: "exit-codes", label: "Exit codes" },
  { id: "incomplete", label: "Incomplete scans" },
  { id: "json", label: "JSON output" },
  { id: "limits", label: "Rate limits and stopping" },
  { id: "ci", label: "CI example" },
];

export default function CliPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="CLI"
        title="Command-Line Interface"
        description={`Run a ${APP_NAME} scan from a terminal or a CI job and fail the build when findings cross a threshold you set. Run it with npx, no install required.`}
      />

      <DocsSection id="overview" title="Overview">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The <InlineCode>vulnradar</InlineCode> CLI wraps the scan API: it
          starts a scan, polls until it finishes, prints a summary, and exits
          non-zero when the finding counts go over the limits you set. That exit
          code is the whole point: drop it into a pipeline step and a regression
          fails the build.
        </p>
        <DocsCallout variant="info" title="It is the scan API underneath">
          Every flag maps to the same <InlineCode>POST /api/v3/scan</InlineCode>{" "}
          the rest of these docs cover, so anything the CLI does you can also do
          with a raw request. Authentication is the same Bearer API key.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="install" title="Install">
        <p className="text-sm text-muted-foreground">
          The CLI is on npm as <InlineCode>vulnradar</InlineCode>.{" "}
          <InlineCode>npx</InlineCode> needs no install at all, which is usually
          what you want in CI:
        </p>
        <CodeBlock
          language="bash"
          code={`npx vulnradar scan https://example.com --max-high 0`}
        />
        <p className="text-sm text-muted-foreground">
          For a permanent command on your PATH:
        </p>
        <CodeBlock
          language="bash"
          code={`npm i -g vulnradar
vulnradar scan https://example.com --api-key vr_live_...`}
        />
        <p className="text-sm text-muted-foreground">
          It needs Node 22.12 or newer (
          <InlineCode>cli/package.json</InlineCode> declares{" "}
          <InlineCode>engines.node &gt;=22.12.0</InlineCode>, the first Node 22
          release where the JSON import it reads its own version with is
          stable), and has no dependencies of its own.
        </p>
        <DocsSubSection title="From source">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Only needed to work on the CLI itself, or to run a change that is
            not released yet:
          </p>
          <CodeBlock
            language="bash"
            code={`git clone https://github.com/${APP_REPO}.git
cd vulnradar.dev/cli
npm install -g .`}
          />
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Or run the entrypoint directly with{" "}
            <InlineCode>node cli/vulnradar.mjs scan &lt;url&gt;</InlineCode>, no
            install at all.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="usage" title="Usage">
        <CodeBlock language="text" code={`vulnradar scan <url> [options]`} />
        <p className="text-sm text-muted-foreground">
          Pass your key with <InlineCode>--api-key</InlineCode> or the{" "}
          <InlineCode>VULNRADAR_TOKEN</InlineCode> environment variable. Create
          the key under Profile &gt; Developer &gt; API Keys. Prefer the
          variable in CI so the key never lands in shell history or logs.{" "}
          <InlineCode>--api-base</InlineCode> has the same env form,{" "}
          <InlineCode>VULNRADAR_API_BASE</InlineCode>, so a self-hosted CI does
          not repeat the flag on every invocation. An explicit flag beats the
          variable in both cases.
        </p>
      </DocsSection>

      <DocsSection id="options" title="Options">
        <DocsTable
          columns={[
            { key: "flag", header: "Flag" },
            { key: "desc", header: "What it does" },
            { key: "def", header: "Default" },
          ]}
          data={[
            {
              flag: "--api-key <key>",
              desc: "API token. Falls back to VULNRADAR_TOKEN.",
              def: "env",
            },
            {
              flag: "--api-base <url>",
              desc: "API base URL, for a self-hosted instance. Falls back to VULNRADAR_API_BASE.",
              def: `${APP_URL}/api/${API_VERSION}`,
            },
            {
              flag: "--allow-insecure",
              desc: "Allow a plain http:// --api-base to a host that is not this machine. The key is sent unencrypted, so the CLI refuses without it. localhost is always allowed.",
              def: "off",
            },
            {
              flag: "--crawl",
              desc: `Crawl and scan multiple pages instead of a single URL. The cap depends on your plan (Free ${CONFIG_BILLING_FREE_CRAWL_PAGES}, Core ${CONFIG_BILLING_CORE_SUPPORTER_CRAWL_PAGES}, Pro ${CONFIG_BILLING_PRO_SUPPORTER_CRAWL_PAGES}, Elite ${CONFIG_BILLING_ELITE_SUPPORTER_CRAWL_PAGES}).`,
              def: "off",
            },
            {
              flag: "--max-critical <n>",
              desc: "Exit 1 if criticals exceed n. 0 or more.",
              def: "0",
            },
            {
              flag: "--max-high <n>",
              desc: "Exit 1 if highs exceed n. 0 or more.",
              def: "0",
            },
            {
              flag: "--max-medium <n>",
              desc: "Exit 1 if mediums exceed n. -1 disables the check; only this flag takes -1.",
              def: "-1",
            },
            {
              flag: "--include-suppressed",
              desc: "Count findings you marked a false positive, in the thresholds and in a --report. Off matches what the dashboard shows. The CLI prints how many it left out.",
              def: "off",
            },
            {
              flag: "--allow-incomplete",
              desc: "Do not exit 3 when the scan was blocked by a bot challenge or could not fetch the page. What was not checked is still printed.",
              def: "off",
            },
            {
              flag: "--fail-on-incomplete",
              desc: "Exit 3 when any area was not checked, not only those two.",
              def: "off",
            },
            {
              flag: "--timeout <seconds>",
              desc: `Give up waiting for the scan to finish. With --crawl and no explicit --timeout it becomes ${CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS}, matching the server's crawl budget.`,
              def: `${CONFIG_SCAN_TIMEOUT_SECONDS}`,
            },
            {
              flag: "--cancel-on-timeout",
              desc: "Cancel the scan on the server when the timeout runs out. Otherwise it is left running.",
              def: "off",
            },
            {
              flag: "--poll-interval <s>",
              desc: "Seconds between status polls.",
              def: "5",
            },
            {
              flag: "--scanners <list>",
              desc: "Comma-separated categories to run, e.g. headers,ssl,content. The same names the scan API's scanners field takes.",
              def: "server's standard set",
            },
            {
              flag: "--public / --private",
              desc: "List the scan in the public scans directory, or keep it out of it.",
              def: "account default",
            },
            {
              flag: "--team-id <id>",
              desc: "Share the scan with a team you manage. Repeat the flag for several teams.",
              def: "personal",
            },
            {
              flag: "--report <format>",
              desc: "Download a report once the scan finishes: json, sarif, md, markdown, compliance, csv, pdf. The same formats GET /history/{id}/report serves. Printed to stdout unless --out is given.",
              def: "none",
            },
            {
              flag: "--out <path>",
              desc: "Write the --report file here. Required for pdf, which is binary, and with --json, which owns stdout.",
              def: "stdout",
            },
            {
              flag: "--apply-triage",
              desc: "In the report, mark accepted-risk and won't-fix findings as suppressed. GitHub reads SARIF suppressions as dismissed.",
              def: "off",
            },
            {
              flag: "--json",
              desc: "Print the raw completed result as JSON, and nothing else on stdout. A failure prints a failure document instead.",
              def: "off",
            },
            {
              flag: "-v, --version",
              desc: "Print the CLI version.",
              def: "",
            },
            { flag: "-h, --help", desc: "Show usage.", def: "" },
          ]}
        />
      </DocsSection>

      <DocsSection id="exit-codes" title="Exit codes">
        <DocsTable
          columns={[
            { key: "code", header: "Code" },
            { key: "meaning", header: "Meaning" },
          ]}
          data={[
            {
              code: "0",
              meaning: "Every finding count is at or under its threshold.",
            },
            {
              code: "1",
              meaning:
                "The scan ran and a threshold was exceeded. A real result, and what lets a CI job block a merge on a new critical. It wins over 3.",
            },
            {
              code: "2",
              meaning:
                "The scan could not run: bad arguments, a missing or invalid API key, a network failure, an API error, a failed scan, or a scan that never completed.",
            },
            {
              code: "3",
              meaning:
                "The scan ran but did not check the target: a bot challenge, or the page could not be fetched.",
            },
            {
              code: "130",
              meaning:
                "Interrupted by SIGINT. A scan that was already started is cancelled.",
            },
            {
              code: "143",
              meaning:
                "Interrupted by SIGTERM. A scan that was already started is cancelled.",
            },
          ]}
        />
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          A script that tests for any non-zero exit is unaffected by how many
          codes there are. One that retries when VulnRadar was briefly
          unreachable should retry on <InlineCode>2</InlineCode> only:{" "}
          <InlineCode>1</InlineCode> is a finding and <InlineCode>3</InlineCode>{" "}
          is a site that blocks the scanner, and neither gets better by running
          again.
        </p>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          A report that cannot be fetched or written fails the run with{" "}
          <InlineCode>2</InlineCode>, but never hides a failed gate: that still
          exits <InlineCode>1</InlineCode>. An incomplete scan (
          <InlineCode>3</InlineCode>) outranks a failed report.
        </p>
        <DocsSubSection title="What the gate counts">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            The thresholds judge the scan&apos;s findings, leaving out the ones
            you marked a false positive. The dashboard and every report hide
            them, so a run that failed on one would fail with nothing visible to
            fix. The CLI prints how many it left out, and{" "}
            <InlineCode>--include-suppressed</InlineCode> counts them.
            Accepted-risk and won&apos;t-fix findings are always counted. A
            completed scan whose result has no summary is an error (
            <InlineCode>2</InlineCode>), not zero findings.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="incomplete" title="Incomplete scans">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A scan can finish without ever reading the site: it showed the scanner
          a bot challenge, or the page could not be fetched because of a bad
          certificate, an unreachable host or a redirect to another host. It has
          no findings, and a gate that passed it would pass a site nobody looked
          at. So the CLI always prints what was not checked, to stderr:
        </p>
        <CodeBlock
          language="text"
          code={`Not checked: The page itself: the scanner could not fetch it, so only the checks that never read a page ran
Page unreachable: <the reason>`}
        />
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          It exits <InlineCode>3</InlineCode> when the area was a bot challenge
          or an unreachable page. <InlineCode>--allow-incomplete</InlineCode>{" "}
          accepts the partial scan and keeps the notice.{" "}
          <InlineCode>--fail-on-incomplete</InlineCode> also exits{" "}
          <InlineCode>3</InlineCode> when any other area was skipped, such as
          DNS, TLS or a crawl that ran out of time.
        </p>
      </DocsSection>

      <DocsSection id="json" title="JSON output">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          <InlineCode>--json</InlineCode> makes stdout one JSON document and
          nothing else; progress goes to stderr. A scan that completes prints
          the raw result, which has no <InlineCode>ok</InlineCode> key: the exit
          code is the success signal, not a field. Any failure that stops the
          run prints this instead, and exits <InlineCode>2</InlineCode> (
          <InlineCode>130</InlineCode> or <InlineCode>143</InlineCode> when
          interrupted):
        </p>
        <CodeBlock
          language="json"
          code={`{
  "ok": false,
  "error": "Scan failed: Could not reach the target. [target_unreachable]",
  "scanId": 4821,
  "failureKind": "target_unreachable"
}`}
        />
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Only <InlineCode>ok</InlineCode> and <InlineCode>error</InlineCode>{" "}
          are always there. <InlineCode>scanId</InlineCode> is present once a
          scan has started. <InlineCode>failureKind</InlineCode> says why a scan
          that started then failed, and the message ends with it in brackets.
          When a request is refused instead, <InlineCode>status</InlineCode> is
          its HTTP status and <InlineCode>statusCode</InlineCode> the API&apos;s
          own code from the body, such as{" "}
          <InlineCode>CONCURRENT_SCAN_LIMIT</InlineCode>.{" "}
          <InlineCode>failureKind</InlineCode> and{" "}
          <InlineCode>statusCode</InlineCode> are present only when the API
          sends them.
        </p>
      </DocsSection>

      <DocsSection id="limits" title="Rate limits and stopping">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A 429 when starting a scan is one of three things, and the CLI treats
          them differently. When another scan is already running on the account
          (<InlineCode>CONCURRENT_SCAN_LIMIT</InlineCode>) it waits for the
          slot: the <InlineCode>Retry-After</InlineCode> the server sends, or 5,
          10, then 20 seconds, for at most 120 seconds in total, and that wait
          does not come out of <InlineCode>--timeout</InlineCode>. A spent daily
          quota is not retried, because the wait is hours; it exits{" "}
          <InlineCode>2</InlineCode> and says so. Any other rate limit is
          retried after its <InlineCode>Retry-After</InlineCode>, up to three
          times, if that fits in what is left of the timeout.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          If the run is interrupted with <InlineCode>SIGINT</InlineCode> or{" "}
          <InlineCode>SIGTERM</InlineCode>, the CLI asks the server to cancel
          the scan it started, waiting at most three seconds, and exits{" "}
          <InlineCode>130</InlineCode> or <InlineCode>143</InlineCode>. Without
          that, a cancelled pipeline&apos;s scan would keep holding your only
          scan slot and the re-run would be refused until it finished. When{" "}
          <InlineCode>--timeout</InlineCode> runs out the scan is left running
          by default, because it will finish and appear in your history;{" "}
          <InlineCode>--cancel-on-timeout</InlineCode> cancels it instead.
        </p>
      </DocsSection>

      <DocsSection id="ci" title="CI example">
        <p className="text-sm text-muted-foreground">
          Once the CLI is on the runner (see Install), a GitHub Actions step
          fails the build on any new critical or high:
        </p>
        <CodeBlock
          language="yaml"
          code={`- name: VulnRadar scan
  env:
    VULNRADAR_TOKEN: \${{ secrets.VULNRADAR_TOKEN }}
  run: vulnradar scan https://staging.example.com --max-critical 0 --max-high 0`}
        />
        <p className="text-sm text-muted-foreground">
          A report is downloaded before the thresholds are judged, so the run
          that fails the build still leaves the file behind for the step that
          uploads it:
        </p>
        <CodeBlock
          language="yaml"
          code={`- name: VulnRadar scan
  env:
    VULNRADAR_TOKEN: \${{ secrets.VULNRADAR_TOKEN }}
  run: vulnradar scan https://staging.example.com --report sarif --out results.sarif
- name: Upload to code scanning
  if: always()
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif`}
        />
        <p className="text-sm text-muted-foreground">
          Want a gate with nothing to install? The{" "}
          <a
            href="/docs/api"
            className="text-primary underline-offset-2 hover:underline"
          >
            API docs
          </a>{" "}
          cover a GitHub Action, a GitLab template, and a plain curl script that
          hit the same API.
        </p>
      </DocsSection>
    </div>
  );
}
