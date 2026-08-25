"use client";

import { useEffect, useRef } from "react";
import { useDocsContext, type TocItem } from "@/components/docs/docs-shell";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  DocsTable,
  CodeBlock,
  InlineCode,
} from "@/components/docs";
import { APP_NAME } from "@/lib/config/constants";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "install", label: "Install" },
  { id: "usage", label: "Usage" },
  { id: "options", label: "Options" },
  { id: "exit-codes", label: "Exit codes" },
  { id: "ci", label: "CI example" },
];

export default function CliPage() {
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
        badge="CLI"
        title="Command-Line Interface"
        description={`Run a ${APP_NAME} scan from a terminal or a CI job and fail the build when findings cross a threshold you set. There is no install step: npx fetches it on demand.`}
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
          Run it straight from npm with no global install:
        </p>
        <CodeBlock
          language="bash"
          code={`npx vulnradar scan https://example.com --api-key vr_live_...`}
        />
        <p className="text-sm text-muted-foreground">
          Or install it globally if you call it often:
        </p>
        <CodeBlock
          language="bash"
          code={`npm install -g vulnradar
vulnradar scan https://example.com`}
        />
      </DocsSection>

      <DocsSection id="usage" title="Usage">
        <CodeBlock language="text" code={`vulnradar scan <url> [options]`} />
        <p className="text-sm text-muted-foreground">
          Pass your key with <InlineCode>--api-key</InlineCode> or the{" "}
          <InlineCode>VULNRADAR_TOKEN</InlineCode> environment variable. Prefer
          the variable in CI so the key never lands in shell history or logs.
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
              desc: "API base URL, for a self-hosted instance.",
              def: "https://vulnradar.dev/api/v3",
            },
            {
              flag: "--crawl",
              desc: "Crawl and scan up to 15 pages instead of a single URL.",
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
              desc: "Give up waiting for the scan to finish.",
              def: "300",
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
          A GitHub Actions step that fails the build on any new critical or
          high:
        </p>
        <CodeBlock
          language="yaml"
          code={`- name: VulnRadar scan
  env:
    VULNRADAR_TOKEN: \${{ secrets.VULNRADAR_TOKEN }}
  run: npx vulnradar scan https://staging.example.com --max-critical 0 --max-high 0`}
        />
      </DocsSection>
    </div>
  );
}
