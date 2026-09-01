import Link from "next/link";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
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

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "share-links", label: "Sharing a scan" },
  { id: "public-scans", label: "The Public Scans directory" },
  { id: "redaction", label: "What a viewer can see" },
  { id: "host-reports", label: "Per-host reports" },
  { id: "assets", label: "Assets and attack surface" },
  { id: "badges", label: "Security badges" },
  { id: "compare", label: "Comparing two scans" },
];

export default function SharingDocsPage() {
  return (
    <div className="space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Sharing"
        title="Sharing & Public Pages"
        description="A completed scan does not have to stay in your history. Hand someone a read-only link, list it in a public directory, publish a stable per-host report, drop a live badge in a README, or diff two runs to show what changed. Every surface reads the same stored scan, and every one has an explicit privacy boundary drawn in code."
        stats={[
          { value: "7/30/90", label: "Share expiry, in days" },
          { value: "500", label: "Hosts in the public browse" },
          { value: "30", label: "Scans per host trend" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <div className="max-w-[68ch] space-y-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          <p>
            {APP_NAME} stores each scan once. The public-facing surfaces are
            different views over that one row, each gated by its own flag on the{" "}
            <InlineCode>scan_history</InlineCode> record. Two flags do most of
            the work, and they are deliberately independent of each other:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <InlineCode>share_token</InlineCode> turns a scan into a read-only
              link at <InlineCode>/shared/&lt;token&gt;</InlineCode>. A live
              token also gets a <InlineCode>share_publicly_listed</InlineCode>{" "}
              flag that decides whether the link shows up in the browsable{" "}
              <Link
                href="/public-scans"
                className="text-primary underline-offset-2 hover:underline"
              >
                Public Scans
              </Link>{" "}
              directory.
            </li>
            <li>
              <InlineCode>is_public</InlineCode> decides whether the scan feeds
              the per-host cache behind{" "}
              <InlineCode>/host/&lt;hostname&gt;</InlineCode> and the &quot;all
              public hosts&quot; browse. A scan can be listed in the directory
              and never appear on its host page, or the reverse. Neither flag
              reads the other.
            </li>
          </ul>
          <p>
            Everything below is one of those views. Creating and revoking share
            links, listing them, and building badges are all session-only
            actions, the same as webhooks: a logged-in user, never a Bearer API
            key. The read-only viewer pages, the directory, and the host report
            need no account at all.
          </p>
        </div>
      </DocsSection>

      <DocsSection id="share-links" title="Sharing a scan">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          &quot;Share this scan&quot; issues a 64-character token and returns a
          link to <InlineCode>/shared/&lt;token&gt;</InlineCode>. Anyone with
          the link reads the full report without logging in. The token is stored
          as a SHA-256 hash (<InlineCode>share_token_hash</InlineCode>, added in
          migration 3.1.0), so the plaintext is never compared directly in the
          database.
        </p>

        <DocsSubSection title="Expiry and revocation">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            A link can expire after{" "}
            <strong className="text-foreground">7</strong>,{" "}
            <strong className="text-foreground">30</strong>, or{" "}
            <strong className="text-foreground">90</strong> days, or never (the
            default). Any other value is a <InlineCode>400</InlineCode>. An
            expired link is excluded from the viewer lookup entirely, exactly
            like a revoked one, so its findings never reach a response for even
            one request. Revoking a link (<InlineCode>DELETE</InlineCode> on the
            share route, or the Revoke action on the{" "}
            <Link
              href="/shares"
              className="text-primary underline-offset-2 hover:underline"
            >
              Shared reports
            </Link>{" "}
            page) sets <InlineCode>share_token</InlineCode> back to null, and
            the link stops working immediately for everyone who already has it.
          </p>
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Re-sharing a scan that still has a live token returns the same
            token, so a link you already handed out stays valid. Only once a
            token has actually lapsed does the next share replace it with a
            fresh one.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Who can publish a link">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Publishing or revoking a share is a write action scoped to the
            scan&apos;s own team. The scan&apos;s owner can always do it; a
            teammate can only when the team resource-access check grants write
            on that scan. For a private personal scan there is no team, so the
            owner is the only one who can share it. Anyone else, including a
            team admin reaching for a teammate&apos;s private personal scan,
            gets a generic <InlineCode>404</InlineCode>. The endpoint never
            confirms a scan exists to someone who cannot manage it.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Managing your links">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The Shared reports page lists every one of your links that still
            works (expired ones are filtered out the same way the viewer
            excludes them). Each row can open the share modal, toggle its public
            listing, or revoke it.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="public-scans" title="The Public Scans directory">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The Public Scans directory is an unauthenticated, paginated,
          most-recent-first list of scans someone chose to make discoverable.
          Each entry links straight to its read-only report. A row appears only
          when all three conditions hold on the underlying scan.
        </p>

        <DocsTable
          caption="The conditions a scan must meet to appear in the Public Scans directory"
          columns={[
            { key: "condition", header: "Condition", className: "font-mono" },
            { key: "meaning", header: "What it means", className: "w-full" },
          ]}
          data={[
            {
              condition: "share_token IS NOT NULL",
              meaning:
                "The scan has an active share link. Revoke the link and it drops out of the directory too.",
            },
            {
              condition: "share_publicly_listed = true",
              meaning:
                "The per-share listing flag is on. This is separate from is_public and the host page.",
            },
            {
              condition: "not expired",
              meaning:
                "share_expires_at is null or still in the future, the same live check the viewer uses.",
            },
          ]}
        />

        <DocsSubSection title="What sets the listing flag">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            When a genuinely new share link is created, its listing flag is
            resolved once. An explicit choice on the request wins; otherwise it
            falls back to the scan owner&apos;s account default (
            <InlineCode>share_publicly_listed_by_default</InlineCode>, whose own
            column default is <strong className="text-foreground">true</strong>
            ). The fallback is scoped to the scan owner, not whoever clicked
            Share, because it is the owner&apos;s identity and scans that end up
            listed. If that lookup fails, the share fails closed to{" "}
            <strong className="text-foreground">not listed</strong>: a database
            hiccup should never be the reason a scan lands in a public directory
            its owner never opted into. So in practice, sharing a scan lists it
            by default unless you or your account settings say otherwise.
          </p>
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            After creation, the listing status only changes through the explicit
            per-share toggle in the Shared reports row menu. That toggle
            requires an active share link (a scan with no link returns{" "}
            <InlineCode>400</InlineCode>) and is scoped to the same owner or
            team-write check as sharing itself.
          </p>
          <DocsCallout variant="info" title="Directory rate limit">
            <p>
              The directory API is unauthenticated, so there is no session or
              key to throttle against. It is limited per IP to 60 requests a
              minute; over that returns a <InlineCode>429</InlineCode> with a{" "}
              <InlineCode>Retry-After</InlineCode> header.
            </p>
          </DocsCallout>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="redaction" title="What a viewer can see">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Sharing a scan already exposes its findings, so a read-only viewer of
          your own link sees the whole report: findings, the severity summary,
          response headers, tags, any note you attached, and who ran it (name,
          avatar, staff role, and profile badges). That is the same detail you
          see on your own dashboard, minus the private per-finding remediation
          state, which stays with the owner.
        </p>

        <DocsCallout
          variant="warning"
          title="Redaction only happens for a foreign badge scan"
        >
          <p>
            There is exactly one path where {APP_NAME} redacts. A live security
            badge set to <strong className="text-foreground">global</strong>{" "}
            scope can resolve to a public scan someone <em>else</em> ran. That
            person never consented to being named just because a stranger&apos;s
            badge picked up their scan, so for a foreign scan the viewer shows
            only the aggregate findings: the note is blanked, the identity
            becomes &quot;Community scan&quot; with no avatar and a plain user
            role, and profile badges are skipped. A per-scan share link you
            create for your own scan redacts nothing.
          </p>
        </DocsCallout>

        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The viewer page also carries a subdomain-discovery panel in read-only
          mode. It only ever shows an already-cached snapshot: an anonymous
          visitor has no session or key to kick off a new discovery job, and it
          is not their scan to spend rate-limit budget on.
        </p>
      </DocsSection>

      <DocsSection id="host-reports" title="Per-host reports">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          <InlineCode>/host/&lt;hostname&gt;</InlineCode> is a public, crawlable
          report for a host, in the spirit of securityheaders.com or SSL Labs.
          It reads the <InlineCode>host_reputation</InlineCode> cache and shows
          a host&apos;s most recent{" "}
          <strong className="text-foreground">public</strong> scan: the danger
          score, severity counts, findings, response headers, SSL grade, DNS,
          ports, software inventory, auto-tags, and an AI summary if the owner
          generated one.
        </p>

        <DocsCallout variant="info" title="It never reflects a private scan">
          <p>
            Every writer of the reputation cache skips a non-public scan, and
            flipping a scan from public to private deletes its cached row
            outright. An authenticated scan is always private, so it never lands
            here. A host nobody has publicly scanned comes back as{" "}
            <InlineCode>known: false</InlineCode>, and a bare IP is rejected as
            an invalid hostname.
          </p>
        </DocsCallout>

        <DocsSubSection title="The danger-score trend">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The report also charts the host&apos;s risk score over time. The
            reputation cache only keeps the single latest scan, so the trend
            reads <InlineCode>scan_history</InlineCode> directly under the same
            privacy scope: <InlineCode>is_public = true</InlineCode> and a
            completed status. It matches the host with a boundary-aware pattern,
            so <InlineCode>example.com</InlineCode> and{" "}
            <InlineCode>www.example.com</InlineCode> both count while{" "}
            <InlineCode>evil.example.com</InlineCode> does not, and plots up to
            the 30 most recent scans oldest to newest.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="assets" title="Assets and attack surface">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Two logged-in views sit next to History and Public Scans and roll
          per-scan data up to the host and portfolio level.
        </p>

        <DocsSubSection title="Assets: hosts you have scanned">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The Assets page groups your scans by host, most-recently-scanned
            first, with each host&apos;s latest safety verdict and scan count. A
            scope toggle switches what you are looking at:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">My scans</strong> (the
              default) reads your own <InlineCode>scan_history</InlineCode>,
              grouped by host, and honors your plan&apos;s retention window the
              same way your history list does. GitHub repo scans are left out,
              since they have their own view.
            </li>
            <li>
              <strong className="text-foreground">All public hosts</strong> (
              <InlineCode>?scope=all</InlineCode>) reads only the{" "}
              <InlineCode>host_reputation</InlineCode> cache, which is
              public-scan-only by construction. It exposes nothing that is not
              already public on a host page, capped at 500 hosts so the list
              stays a browse and not a dump. Your own private scans never appear
              here.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Attack surface: verified domains">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The{" "}
            <Link
              href="/attack-surface"
              className="text-primary underline-offset-2 hover:underline"
            >
              Attack surface
            </Link>{" "}
            page is your verified-domain portfolio, and it is where you add and
            verify a domain. Verifying a domain proves you own it: a verified
            apex covers every subdomain beneath it and unlocks active probing,
            authenticated scans, and subdomain discovery across those assets.
            The verification backend already existed inside the profile
            Developer tab; this surfaces it as a first-class, portfolio-level
            view of the assets you own and monitor.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="badges" title="Security badges">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A badge is an SVG image that reads &quot;Secured by {APP_NAME}&quot;
          alongside the latest verdict (Safe, Caution, or Unsafe) and scan date,
          linking through to the full read-only report. The key property: a
          badge is tied to a <em>URL</em>, not to one frozen scan. Every time
          you scan that URL again, the same embedded image updates on its own.
          Paste the snippet once and leave it.
        </p>

        <DocsSubSection title="Generating and embedding">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Pick a scan on the{" "}
            <Link
              href="/badge"
              className="text-primary underline-offset-2 hover:underline"
            >
              Badge
            </Link>{" "}
            page and it issues an auto-updating token for that URL. The token is
            idempotent per URL, so asking twice returns the same one and your
            embed code never has to change. Copy one of the three snippets:
          </p>
          <CodeBlock
            filename="HTML"
            language="html"
            code={`<a href="${APP_URL}/shared/YOUR_TOKEN" target="_blank" rel="noopener noreferrer" style="display: inline-block;"><img src="${APP_URL}/api/v3/badge/YOUR_TOKEN" alt="Secured by ${APP_NAME}" style="border: 0;"/></a>`}
          />
          <CodeBlock
            filename="Markdown"
            language="text"
            code={`[![Secured by ${APP_NAME}](${APP_URL}/api/v3/badge/YOUR_TOKEN)](${APP_URL}/shared/YOUR_TOKEN)`}
          />
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The image lives at{" "}
            <InlineCode>/api/v3/badge/&lt;token&gt;</InlineCode> and the
            click-through goes to <InlineCode>/shared/&lt;token&gt;</InlineCode>
            . The image is cached for an hour, so a fresh scan may take up to
            that long to show through a CDN.
          </p>
        </DocsSubSection>

        <DocsSubSection title="User scope vs global scope">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            A badge&apos;s scope decides which scan it reflects, and you can
            toggle it any time without regenerating the token.
          </p>
          <DocsTable
            caption="Badge scope options and which scan each one resolves to"
            columns={[
              { key: "scope", header: "Scope", className: "font-mono" },
              { key: "resolves", header: "Resolves to", className: "w-full" },
            ]}
            data={[
              {
                scope: "user",
                resolves:
                  "The default. Only your own scans of that URL. The badge updates when you rescan it, and never leaves your account.",
              },
              {
                scope: "global",
                resolves:
                  "The newest scan of that URL by anyone, but only if that scan's owner marked it public. Lets the badge stay current when other people scan the URL too.",
              },
            ]}
          />
          <DocsCallout
            variant="info"
            title="Global scope keeps other people private"
          >
            <p>
              When a global badge resolves to a scan you did not run, only the
              findings summary is shown. That scan&apos;s notes and the identity
              of whoever ran it stay private, and the public gate (
              <InlineCode>is_public = true</InlineCode>) means a stranger&apos;s
              private or authenticated scan can never be pulled in this way.
            </p>
          </DocsCallout>
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Revoking a badge stops its token from resolving without touching the
            underlying scan history, and an expired or revoked token renders a
            neutral &quot;Link Expired&quot; image instead of a verdict.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="compare" title="Comparing two scans">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The{" "}
          <Link
            href="/compare"
            className="text-primary underline-offset-2 hover:underline"
          >
            Compare
          </Link>{" "}
          page diffs two scans of the same host so you can see what actually
          moved between runs: which findings appeared, which you closed, and
          which have been sitting there the whole time.
        </p>

        <DocsSubSection title="How the diff works">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Pass two scan ids as <InlineCode>a</InlineCode> and{" "}
            <InlineCode>b</InlineCode>. Both are required, and both must belong
            to you: a scan id on another account resolves to{" "}
            <InlineCode>404</InlineCode>, so there is no way to diff scans you
            do not own. The two are ordered oldest first, and their findings are
            matched by title into three buckets:
          </p>
          <DocsTable
            caption="The three buckets a compare produces"
            columns={[
              { key: "bucket", header: "Bucket", className: "font-mono" },
              { key: "meaning", header: "What it means", className: "w-full" },
            ]}
            data={[
              {
                bucket: "added",
                meaning:
                  "Present in the newer scan but not the older one: findings that appeared.",
              },
              {
                bucket: "removed",
                meaning:
                  "Present in the older scan but not the newer one: findings that were fixed or are gone.",
              },
              {
                bucket: "unchanged",
                meaning:
                  "Present in both: findings that have persisted across the two runs.",
              },
            ]}
          />
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The UI only offers hosts with two or more scans on record, since a
            diff needs a before and an after. With exactly two, it runs the diff
            immediately; with more, you pick the pair and the older one becomes
            the base. The selection lives in the URL (
            <InlineCode>?a=&amp;b=</InlineCode>), so a comparison is a link you
            can share with a teammate.
          </p>
        </DocsSubSection>
      </DocsSection>
    </div>
  );
}
