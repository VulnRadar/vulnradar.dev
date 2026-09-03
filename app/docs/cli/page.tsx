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
import { APP_NAME, APP_REPO } from "@/lib/config/constants";
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
        description={`Run a ${APP_NAME} scan from a terminal or a CI job and fail the build when findings cross a threshold you set. Install it from the repo until it lands on npm.`}
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
          It needs Node 22 or newer, the same floor as the rest of the project (
          <InlineCode>cli/package.json</InlineCode> declares{" "}
          <InlineCode>engines.node &gt;=22.0.0</InlineCode>), and has no
          dependencies of its own.
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
          <InlineCode>VULNRADAR_TOKEN</InlineCode> environment variable. Prefer
          the variable in CI so the key never lands in shell history or logs.{" "}
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
              def: "https://vulnradar.dev/api/v3",
            },
            {
              flag: "--crawl",
              desc: `Crawl and scan multiple pages instead of a single URL. The cap depends on your plan (Free ${CONFIG_BILLING_FREE_CRAWL_PAGES}, Core ${CONFIG_BILLING_CORE_SUPPORTER_CRAWL_PAGES}, Pro ${CONFIG_BILLING_PRO_SUPPORTER_CRAWL_PAGES}, Elite ${CONFIG_BILLING_ELITE_SUPPORTER_CRAWL_PAGES}).`,
              def: "off",
            },
            {
              flag: "--max-critical <n>",
              desc: "Exit non-zero if criticals exceed n.",
              def: "0",
            },
            {
              flag: "--max-high <n>",
              desc: "Exit non-zero if highs exceed n.",
              def: "0",
            },
            {
              flag: "--max-medium <n>",
              desc: "Exit non-zero if mediums exceed n. -1 disables the check.",
              def: "-1",
            },
            {
              flag: "--timeout <seconds>",
              desc: `Give up waiting for the scan to finish. With --crawl and no explicit --timeout it becomes ${CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS}, matching the server's crawl budget.`,
              def: `${CONFIG_SCAN_TIMEOUT_SECONDS}`,
            },
            {
              flag: "--poll-interval <s>",
              desc: "Seconds between status polls.",
              def: "5",
            },
            {
              flag: "--json",
              desc: "Print the raw completed result as JSON.",
              def: "off",
            },
            { flag: "-h, --help", desc: "Show usage.", def: "" },
          ]}
        />
      </DocsSection>

      <DocsSection id="exit-codes" title="Exit codes">
        <p className="text-sm text-muted-foreground">
          <InlineCode>0</InlineCode> when every finding count is at or under its
          threshold; <InlineCode>1</InlineCode> when a threshold is exceeded or
          the scan errors out. That is what lets a CI job block a merge on a new
          critical.
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
