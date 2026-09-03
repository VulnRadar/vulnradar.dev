import Link from "next/link";

import { APP_NAME } from "@/lib/config/constants";
import {
  CONFIG_SCAN_TIMEOUT_SECONDS,
  CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS,
  CONFIG_BULK_SCAN_TIMEOUT_SECONDS,
  CONFIG_SCAN_FETCH_TIMEOUT_MS,
  CONFIG_CRAWL_PAGE_FETCH_TIMEOUT_MS,
} from "@/lib/config/config-values";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  DocsTable,
  InlineCode,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "statuses", label: "What each scan status means" },
  { id: "errors", label: "Failure messages, and what to do" },
  { id: "timeouts", label: "Timeouts" },
  { id: "blocked", label: "Targets we refuse to scan" },
  { id: "zero-findings", label: "A scan with no findings" },
  { id: "incomplete", label: "Partial results" },
  { id: "robots", label: "robots.txt and crawling" },
  { id: "quota", label: "Does a failed scan cost quota" },
  { id: "still-stuck", label: "Still stuck" },
];

export default function TroubleshootingPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Scanning"
        title="Troubleshooting Scans"
        description="A scan that failed, timed out, was refused, or came back with nothing. What each outcome actually means, which of them are the target's behaviour rather than a bug, and what to do next."
        stats={[
          { value: "4", label: "Scan statuses" },
          {
            value: `${CONFIG_SCAN_TIMEOUT_SECONDS}s`,
            label: "Default scan ceiling",
          },
          { value: "5", label: "Redirect hops followed" },
        ]}
      />

      <DocsSection id="statuses" title="What each scan status means">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Every scan is a row with one of four statuses. Two are in progress and
          two are final, and a scan that has reached a final status never moves
          again: if a scan is marked failed by the timeout watchdog and the work
          later finishes anyway, it stays failed.
        </p>
        <DocsTable
          caption="The four scan statuses and what each one means"
          columns={[
            { key: "status", header: "Status", className: "font-mono" },
            { key: "meaning", header: "Meaning", className: "w-full" },
          ]}
          data={[
            {
              status: "pending",
              meaning:
                "Accepted and queued, no work started yet. A bulk batch reserves a row for every URL up front, so the last URL in a large batch can sit here for a while.",
            },
            {
              status: "running",
              meaning:
                "Checks are executing. Progress counts up as categories finish.",
            },
            {
              status: "completed",
              meaning:
                "The scan finished. This does not mean findings were found, and it does not mean every check ran: see partial results below.",
            },
            {
              status: "failed",
              meaning:
                "The scan stopped without a result. The reason is stored on the scan and shown on the scanning screen.",
            },
          ]}
        />
        <DocsCallout variant="info" title="A scan interrupted by a restart">
          <p>
            If the server restarts mid-scan, the scan cannot resume: nothing was
            saved yet. On the next boot, any scan left in progress past a grace
            period is marked failed with{" "}
            <em>Scan interrupted by a server restart. Please run it again.</em>{" "}
            Running it again is the fix, and it is not a sign of a problem with
            the target.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="errors" title="Failure messages, and what to do">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Failure reasons are deliberately normalised before you see them: the
          raw error can contain internal detail, so it is classified into one of
          a small set of messages. Here is what each one means in practice.
        </p>
        <DocsTable
          caption="Every scan failure message and its usual cause"
          columns={[
            { key: "message", header: "What you see" },
            { key: "cause", header: "What it usually is", className: "w-full" },
          ]}
          data={[
            {
              message: "The target's hostname could not be resolved.",
              cause:
                "DNS returned nothing for the hostname. Check for a typo, a domain that has not propagated yet, or a host that only resolves inside a private network.",
            },
            {
              message: "The target did not respond in time.",
              cause:
                "The connection opened but the response never arrived inside the timeout. Common on very slow origins and on hosts that silently drop non-browser traffic.",
            },
            {
              message: "The target refused the connection or closed it early.",
              cause:
                "Connection refused or reset. Nothing is listening on that port, or a firewall dropped us. Confirm the URL scheme and port are the ones the site actually serves.",
            },
            {
              message: "The target's TLS certificate could not be validated.",
              cause:
                "Self-signed, expired, wrong hostname, or an incomplete chain. This is a real finding about the site, not a scanner fault: check it in a browser.",
            },
            {
              message: "Cancelled",
              cause: "You stopped the scan. Nothing was recorded.",
            },
            {
              message: `Scan exceeded the ${CONFIG_SCAN_TIMEOUT_SECONDS}s time limit.`,
              cause:
                "The watchdog fired. A crawl says the same thing as “Crawl scan exceeded the ...s time limit.” against its own, larger budget. See timeouts below.",
            },
            {
              message:
                "The scan could not be completed because of an internal error. Please try again.",
              cause:
                "The catch-all. Retry once; if it repeats on the same URL, open a support ticket with the URL and roughly when you ran it, and the error log will have the detail.",
            },
          ]}
        />
        <DocsCallout variant="info" title="Retrying">
          <p>
            The scanning screen&rsquo;s <strong>Try again</strong> keeps every
            option you chose (mode, check families, screenshot, port scan) and
            re-runs the same scan. Rescanning from your history is a plain
            rescan of the URL with default options, so if you need the same
            configuration, start it from the scan form instead.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="timeouts" title="Timeouts">
        <p className="text-sm leading-relaxed text-muted-foreground">
          A watchdog gives every scan a hard ceiling, so a target that stalls
          cannot hold a slot open indefinitely. When it fires, in-flight
          requests are aborted and the scan is marked failed. The ceilings below
          are shipped defaults; on a self-hosted instance they are admin
          settings.
        </p>
        <DocsTable
          caption="The whole-scan time limits, by scan type"
          columns={[
            { key: "kind", header: "Scan type" },
            { key: "limit", header: "Default ceiling" },
          ]}
          data={[
            {
              kind: "Single URL",
              limit: `${CONFIG_SCAN_TIMEOUT_SECONDS} seconds`,
            },
            {
              kind: "Crawl",
              limit: `${CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS} seconds`,
            },
            {
              kind: "Bulk batch",
              limit: `${CONFIG_BULK_SCAN_TIMEOUT_SECONDS} seconds for the whole batch`,
            },
          ]}
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Separately, each individual request has its own much shorter timeout:{" "}
          {CONFIG_SCAN_FETCH_TIMEOUT_MS / 1000} seconds for a page fetch and{" "}
          {CONFIG_CRAWL_PAGE_FETCH_TIMEOUT_MS / 1000} seconds for a crawled
          page. A request hitting that limit does{" "}
          <strong className="text-foreground">not</strong> fail the scan: the
          affected group of checks is reported as incomplete and the rest of the
          scan continues.
        </p>
        <DocsCallout
          variant="warning"
          title="A whole-scan timeout usually means the target is slow, not that the scan was too big"
        >
          <p>
            The checks run in parallel, so a typical scan finishes in seconds.
            Hitting a five-minute ceiling almost always means individual
            requests to the target are each taking many seconds, which is worth
            knowing about the site in its own right. Try a Quick scan first to
            confirm the host responds at all.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="blocked" title="Targets we refuse to scan">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Some URLs are rejected before a scan starts. These come back
          immediately rather than after a wait, and they cost no daily quota.
        </p>

        <DocsSubSection title="Internal and private addresses">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {APP_NAME} will not scan anything that resolves inside a private
            network. That covers literal private and loopback addresses,{" "}
            <InlineCode>localhost</InlineCode> and anything under{" "}
            <InlineCode>.local</InlineCode>, <InlineCode>.internal</InlineCode>{" "}
            or <InlineCode>.lan</InlineCode>, cloud metadata ranges, and any
            public hostname whose DNS answer points at a private address. The
            check is re-run on every redirect hop, so a public URL cannot
            redirect the scanner onto an internal one.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This is not configurable, and it is the correct behaviour for a
            hosted scanner: without it, anyone could use the service to probe
            our own infrastructure. To scan an internal application, run a
            self-hosted instance inside that network.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Blocked by an operator">
          <p className="text-sm leading-relaxed text-muted-foreground">
            An operator can blocklist specific hosts, domains or IP ranges. The
            response is{" "}
            <em>
              This target cannot be scanned, with a note that the domain has
              been restricted for security, privacy or compliance reasons
            </em>
            . If you own the domain and believe it was blocked in error, open a
            support ticket; the block is a deliberate operator decision, so
            retrying will not clear it.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Active probing on an unverified domain">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Active probes send real payloads at a target, so they only run
            against a domain you have proved you own. Asking for them on an
            unverified domain is refused outright rather than silently
            downgraded to a passive scan. Verify the domain first, or run the
            scan without active probes.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Too many at once">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Each plan caps how many scans you may have running simultaneously,
            separately from the daily total. Hitting it returns a message naming
            how many you already have running. Wait for one to finish. See{" "}
            <Link
              href="/docs/rate-limits"
              className="text-primary underline-offset-2 hover:underline"
            >
              Rate Limits
            </Link>
            .
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="zero-findings" title="A scan with no findings">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Zero findings is a valid result, and the report says so explicitly
          rather than looking broken. It usually means exactly what it says.
          There are a few cases where it means fewer checks ran than you might
          expect, and all of them are visible on the report:
        </p>
        <ul className="list-disc space-y-2 pl-6 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">You scanned a raw IP.</strong>{" "}
            The page-content engine is skipped entirely for a bare IPv4 target.
            Only DNS, TLS, reputation and the live fetch run. Scan the hostname
            instead if there is one.
          </li>
          <li>
            <strong className="text-foreground">
              You scanned over plain HTTP.
            </strong>{" "}
            The whole TLS and certificate family is not applicable and is not
            planned at all.
          </li>
          <li>
            <strong className="text-foreground">
              The response was not HTML.
            </strong>{" "}
            Checks that need a document to inspect (scripts, forms, cookies,
            CSP) declare that requirement and are counted as skipped rather than
            passed. A JSON API endpoint legitimately produces a short report.
          </li>
          <li>
            <strong className="text-foreground">
              You scanned a non-HTTP protocol.
            </strong>{" "}
            For a target like an FTP or database URL, only the protocol-specific
            and banner checks apply.
          </li>
          <li>
            <strong className="text-foreground">
              You narrowed the check families.
            </strong>{" "}
            Selecting a subset on the scan form does exactly that. The report
            shows how many checks ran, so compare that number against a full
            scan.
          </li>
          <li>
            <strong className="text-foreground">
              Active probes were not requested.
            </strong>{" "}
            They never run unless you ask for them, so an injection-class
            finding will not appear in a default scan.
          </li>
        </ul>
        <DocsCallout variant="warning" title="A WAF can make a site look clean">
          <p>
            If a firewall or bot-protection layer answers instead of your
            application, the scan completes successfully against the block page,
            not your site. The tell is a very short report with an unexpected
            status code or a tiny response body. Allowlist the scanner, or scan
            from a self-hosted instance inside your perimeter.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="incomplete" title="Partial results">
        <p className="text-sm leading-relaxed text-muted-foreground">
          When one group of checks cannot complete, the scan is not failed and
          the rest is not thrown away. The report names which group was
          incomplete: <strong className="text-foreground">DNS records</strong>,{" "}
          <strong className="text-foreground">
            TLS and certificate checks
          </strong>
          , or <strong className="text-foreground">Live page fetch</strong>. The
          engine confidence figure on the report drops accordingly, which is the
          honest way to say the result is thinner than usual rather than
          pretending the missing checks passed.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A repeated incomplete group on the same target is usually a slow or
          rate-limiting authoritative DNS server, or a TLS handshake the target
          drops for non-browser clients. Rerunning often clears a one-off.
        </p>
      </DocsSection>

      <DocsSection id="robots" title="robots.txt and crawling">
        <p className="text-sm leading-relaxed text-muted-foreground">
          A single-URL scan does not ask robots.txt for permission: you supplied
          the URL. Crawl discovery does read it, and honours{" "}
          <InlineCode>Disallow</InlineCode> rules from a group naming{" "}
          <InlineCode>{APP_NAME}</InlineCode> as the user agent. A blanket{" "}
          <InlineCode>User-agent: *</InlineCode> group is deliberately ignored,
          because a generic bot policy should not stop you from scanning your
          own site.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          So if a crawl came back with fewer pages than you expected, check for
          a <InlineCode>User-agent: {APP_NAME}</InlineCode> group in the
          target&rsquo;s robots.txt. Disallowed paths are skipped silently: they
          are not listed and not fetched. Selecting pages by hand bypasses
          discovery, so a path excluded that way can still be scanned
          deliberately.
        </p>
        <DocsCallout variant="info" title="A crawl that finds nothing at all">
          <p>
            If discovery turns up no scannable pages, the crawl stops with a
            message saying so: the site may block automated crawling or have no
            internal links to follow. A single-page app that renders its
            navigation only in JavaScript is the most common case. Scan the
            individual URLs instead.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="quota" title="Does a failed scan cost quota">
        <p className="text-sm leading-relaxed text-muted-foreground">
          It depends on where it stopped, and the rule is deliberate: your daily
          count is charged <strong className="text-foreground">after</strong>{" "}
          validation, not before.
        </p>
        <DocsTable
          caption="Whether each outcome consumes daily scan quota"
          columns={[
            { key: "outcome", header: "Outcome" },
            { key: "quota", header: "Quota" },
          ]}
          data={[
            {
              outcome: "Refused as an invalid or blocked URL",
              quota: "Not charged",
            },
            {
              outcome: "Refused for an unverified domain",
              quota: "Not charged",
            },
            {
              outcome: "Refused by the concurrency or burst limit",
              quota: "Not charged",
            },
            { outcome: "Started, then failed or timed out", quota: "Charged" },
            { outcome: "Cancelled by you after it started", quota: "Charged" },
            { outcome: "Completed", quota: "Charged" },
          ]}
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          A crawl charges per page as it goes rather than up front, so a crawl
          that stops early only costs the pages it actually scanned. If your
          remaining quota is smaller than the page count you asked for, the
          crawl scans what it can and reports the rest as skipped instead of
          failing.
        </p>
      </DocsSection>

      <DocsSection id="still-stuck" title="Still stuck">
        <p className="text-sm leading-relaxed text-muted-foreground">
          The scanning screen shows the sanitized failure reason with a copy
          button under &ldquo;Scanner output&rdquo;. Include that string, the
          URL, and roughly when you ran it in a support ticket and an operator
          can match it against the server-side error log, which carries the
          detail the public message deliberately omits.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Running your own instance? The same failures are visible under{" "}
          <strong className="text-foreground">
            Admin &rarr; Operations &rarr; Error Logs
          </strong>{" "}
          with the underlying exception, and{" "}
          <strong className="text-foreground">Scanner Queue</strong> shows
          anything stuck in progress. Both are covered on the{" "}
          <Link
            href="/docs/administration"
            className="text-primary underline-offset-2 hover:underline"
          >
            Administration
          </Link>{" "}
          page.
        </p>
      </DocsSection>
    </div>
  );
}
