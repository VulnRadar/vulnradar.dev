import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import {
  APP_NAME,
  APP_REPO,
  ROUTES,
  TOTAL_CHECKS_LABEL,
  CHROME_WEB_STORE_URL,
  FIREFOX_ADDON_URL,
} from "@/lib/config/constants";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSteps,
  DocsCallout,
  DocsFigure,
  InlineCode,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "install", label: "Install" },
  { id: "scanning", label: "Scanning from the popup" },
  { id: "reading-a-result", label: "Reading a result in the popup" },
  { id: "scan-a-link", label: "Scanning a link you haven't opened" },
  { id: "reputation-card", label: "The on-page card" },
  { id: "auto-scan", label: "Auto-scan modes" },
  { id: "notifications", label: "Desktop notifications" },
  { id: "signed-in-pages", label: "Pages you're signed into" },
  { id: "settings", label: "Settings" },
  { id: "permissions", label: "Permissions and privacy" },
];

export default function ExtensionPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Browser Extension"
        title="Browser Extension"
        description="Scan the page you're actually looking at, without pasting a URL. The extension runs the same engine as the web app, connected to your own account with an API key."
        stats={[
          { value: "Chrome + Firefox", label: "Manifest V3" },
          { value: TOTAL_CHECKS_LABEL, label: "Checks, same engine" },
          { value: "0", label: "Page content ever collected" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The extension is a thin client over the same scan engine and the same
          account as the web app: it doesn't store findings locally beyond a
          small recent-history cache, and it doesn't run its own copy of the
          checks. Two things it can do that the web app can't from a URL bar
          alone: react to the page you're currently on (the on-page reputation
          card, auto-scan on navigation) and read a page the way you're actually
          seeing it, cookies and all, when you ask for that explicitly.
        </p>
      </DocsSection>

      <DocsSection id="install" title="Install">
        <DocsCallout variant="success" title="Live on both stores">
          Chrome and other Chromium browsers (Edge, Brave) install from the
          Chrome Web Store; Firefox installs from Firefox Add-ons, which
          approved the listing on 2026-08-15. Both update themselves.
        </DocsCallout>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-5 border-border/50 bg-card/50 flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-foreground">
                Chrome / Edge
              </h3>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-[hsl(var(--success))]/30 text-[hsl(var(--success))]"
              >
                Live
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4 flex-1">
              One click from the store. Updates itself from here on, no manual
              re-download.
            </p>
            <Button asChild className="gap-1.5">
              <a
                href={CHROME_WEB_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Add to Chrome
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          </Card>

          <Card className="p-5 border-border/50 bg-card/50 flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-foreground">Firefox</h3>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-[hsl(var(--success))]/30 text-[hsl(var(--success))]"
              >
                Live
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4 flex-1">
              One click from Firefox Add-ons. Updates itself from here on, no
              manual re-download.
            </p>
            <Button asChild className="gap-1.5">
              <a
                href={FIREFOX_ADDON_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Add to Firefox
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          </Card>
        </div>

        {/* The old step 1 told Firefox users to load a temporary add-on
            "until the AMO listing is live". It has been live since
            2026-08-15, and the card above already links to it, so the two
            halves of this screen contradicted each other. Unpacked loading is
            now a build-from-source note, not the install path. */}
        <DocsSteps
          steps={[
            {
              step: 1,
              title: "Connect your account",
              description: `Click the toolbar icon, then Settings. Create an API key under Profile, Developer, API Keys on ${APP_NAME}, paste it in and press Test & Save. The extension authenticates as you from then on.`,
            },
          ]}
        />

        <p className="text-sm text-muted-foreground">
          Needs Chrome 120 or newer (Edge, Brave and other Chromium browsers at
          the same version work too), Firefox 140 or newer, or Firefox for
          Android 142 or newer. Ctrl+Shift+U opens the popup (Command+Shift+U on
          Chrome for macOS).
        </p>

        <DocsCallout variant="info" title="Building from source instead">
          <p>
            Working on the extension, or want to run an unreleased build? In
            Chrome, <InlineCode>chrome://extensions</InlineCode> &rarr;
            Developer mode &rarr; Load unpacked, and pick the built folder. In
            Firefox,{" "}
            <InlineCode>about:debugging#/runtime/this-firefox</InlineCode>{" "}
            &rarr; Load Temporary Add-on &rarr; select any file inside it. A
            temporary add-on is removed when Firefox restarts, which is why this
            is a development path and not the way to install the extension.
          </p>
        </DocsCallout>

        {/* The profile page keys its tabs off query params, not a hash, so
            /profile#api-keys just opened the default tab. */}
        <p className="text-sm text-muted-foreground">
          Need an API key first? Generate one from{" "}
          <InlineCode>
            {ROUTES.PROFILE}?tab=developer&amp;dtab=api-keys
          </InlineCode>{" "}
          while logged in.
        </p>
      </DocsSection>

      <DocsSection id="scanning" title="Scanning from the popup">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Click the toolbar icon on any page and hit Scan. Quick scans the one
          address you are on. Deep also follows links from it to other pages on
          the same site, so it takes minutes, not seconds. Both run the check
          families you have switched on in the extension's own Settings,
          independent of your web app defaults, so you can keep the popup fast
          day-to-day and still reach every check when you want it.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A scan started from the popup counts against the same daily limit as
          any other scan on your account and shows up in your regular scan
          history: there's no separate extension-only history to lose track of.
        </p>
      </DocsSection>

      <DocsSection id="reading-a-result" title="Reading a result in the popup">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The popup is not a summary you then go elsewhere to act on. Three
          things happen without leaving it:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Expand any finding</strong> for
            where it was found, why it matters, the numbered fix steps, and the
            reference links. The API already returned all of that; the popup
            used to render only the title and description and drop the rest.
          </li>
          <li>
            <strong className="text-foreground">Export a saved scan</strong> as
            PDF, SARIF, Markdown, or JSON. It calls the same{" "}
            <InlineCode>GET /api/v3/history/[id]/report</InlineCode> the
            dashboard and CI use, so the file is byte-identical rather than a
            second formatter that can drift.
          </li>
          <li>
            <strong className="text-foreground">Per-site history</strong>, where
            each row shows the delta against the next-older scan of the same URL
            (fewer or more findings) and carries an inline rescan button.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="scan-a-link" title="Scanning a link you haven't opened">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Right-click any link, anywhere, and choose{" "}
          <strong className="text-foreground">
            Scan this link with {APP_NAME}
          </strong>
          . The scan runs against the link target without navigating to it,
          which is the point: you can check a search result, a forum post, or an
          emailed link before deciding whether to open it. It uses the same
          settings and the same daily limit as a popup scan, and finishes with
          the same desktop notification.
        </p>
        <DocsFigure
          src="/extension/scan-link-context-menu.png"
          alt={`Browser link context menu on a search results page, with "Scan this link with ${APP_NAME}" as the last item`}
          width={533}
          height={333}
          caption="The link context menu on a search results page. Nothing is opened: the scan runs against the link target."
        />
      </DocsSection>

      <DocsSection id="reputation-card" title="The on-page card">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A small card can appear in the corner of a page reporting one of two
          things: this host has been scanned before (and what its last result
          was), or it hasn't and you can scan it now. It is on by default and
          each half has its own switch in Settings. Site alerts are entirely
          separate from auto-scan below: this is about surfacing information,
          not triggering a scan on its own.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">What it sends:</strong> to pick
            the card, the extension asks {APP_NAME} about each public site you
            open, with the hostname and the page's address without its query
            string or fragment, at most once every 45 seconds per site. It reads
            existing scans and stores nothing. Nothing is sent from a private
            window, or for localhost, an IP address, or an intranet name (one
            ending in .localhost, .local, .internal, .lan, .test or .home.arpa,
            or with no dot at all). Because the query string is left out, a page
            that was scanned with one shows the site-level result for now, not
            its own.
          </li>
          <li>
            <strong className="text-foreground">Scan this site</strong> scans
            the address the card was shown for, which is the page's address
            without its query string. The extension remembers what it offered in
            that tab and ignores any other address, and the card only reacts to
            a real click.
          </li>
          <li>
            <strong className="text-foreground">Doesn't repeat itself:</strong>{" "}
            once you've seen the card for a host, it stays quiet on later page
            loads and tab switches to that same host for 4 hours, unless a new
            scan actually changes the result.
          </li>
          <li>
            <strong className="text-foreground">Not this site:</strong> mutes
            the card for that host (or a URL pattern) permanently, from the card
            itself or Settings &gt; Site Alerts.
          </li>
          <li>
            <strong className="text-foreground">Snooze 24h:</strong> a
            temporary, self-expiring version of the same mute for one host.
          </li>
          <li>
            The known-result and scan-prompt halves of the card are each
            controlled by their own toggle in Settings, so you can keep one and
            turn off the other.
          </li>
        </ul>
        <DocsFigure
          src="/extension/on-page-card.png"
          alt="The on-page card in the corner of a checkout page, showing a danger score of 3, one high and one medium finding, when it was last scanned, and Snooze 24h, Not this site and Turn off controls"
          width={533}
          height={333}
          caption="The card on a host scanned three days ago: the danger score, the severity counts, and the three ways to make it stop."
        />
      </DocsSection>

      <DocsSection id="auto-scan" title="Auto-scan modes">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Off by default. Three modes decide when a scan fires without you
          clicking anything, and a scan that fires on its own is more careful
          than one you start:
        </p>
        {/* A name plus a sentence, three times over, is a definition list.
          As a three-across card grid it read as generic filler and cost the
          descriptions their line length. */}
        <dl className="divide-y divide-border/50 border-y border-border/50">
          {[
            {
              name: "On page load",
              description: "Scans a page when it finishes loading.",
            },
            {
              name: "On tab focus",
              description: "Scans the page of a tab when you switch to it.",
            },
            {
              name: "On URL change",
              description:
                "Scans when a tab's address changes, including in-page navigation on single-page apps, not just full page loads.",
            },
          ].map((mode) => (
            <div key={mode.name} className="py-4">
              <dt className="text-sm font-semibold text-foreground">
                {mode.name}
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {mode.description}
              </dd>
            </div>
          ))}
        </dl>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Two limits keep it from spending your daily limit. By default there is
          at most one automatic scan of a site every 6 hours (the same-site
          cooldown) and at most one every 60 seconds across all sites (the
          throttle). Both are in Settings, and 0 turns either one off. The
          cooldown is per hostname, so moving around one site does not rescan
          it.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            Skipped entirely: private windows, localhost, IP addresses and
            intranet names, and any address with a token, code, key, secret,
            signature, OTP, reset or session in its query string.
          </li>
          <li>
            The part of the address after # is never sent, and an automatic scan
            never runs active probing or the port sweep, even when those are
            switched on in Settings. Those are for scans you start.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">
          A whitelist and a blacklist (plain text matched anywhere in the
          address, case-insensitive) and a global pause are available in
          Settings for sites or stretches of time you never want auto-scanned,
          regardless of mode. The blacklist does not stop the on-page card; mute
          a site from the card or under Site Alerts for that.
        </p>
        <DocsFigure
          src="/extension/auto-scan-settings.png"
          alt="The extension settings page on Site Alerts, showing the two on-page card toggles above an auto-scan trigger picker with Off, On tab focus, On page load and On URL change"
          width={533}
          height={333}
          caption="Settings > Site Alerts. The card toggles and the auto-scan trigger are separate controls: the card can stay on with auto-scan off."
        />
      </DocsSection>

      <DocsSection id="notifications" title="Desktop notifications">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Any scan that wasn&apos;t started from the popup finishes with a
          desktop notification carrying the finding count and the worst issue,
          because a background scan you never look at is not worth running.
          Clicking it opens the full report. The severity threshold that decides
          whether a result is worth notifying you about is in Settings, so a
          site with three info-level findings can stay quiet. Firefox for
          Android has no desktop notifications, so there the toolbar badge is
          the only signal.
        </p>
        <DocsFigure
          src="/extension/scan-finished-notification.png"
          alt="A desktop notification reading: 3 findings on shop.example.com, Missing Content-Security-Policy header +2 more"
          width={533}
          height={333}
          caption="A finished background scan. The notification names the host and the worst finding, and opens the report when clicked."
        />
      </DocsSection>

      <DocsSection id="signed-in-pages" title="Pages you're signed into">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          If the extension detects a session cookie on the current page (a
          heuristic against well-known cookie names, not a guarantee), the
          reputation card says so and links to authenticated scanning on the web
          app instead of prompting you to scan it directly. A regular scan
          always checks a site the way a logged-out visitor sees it (headers,
          TLS, cookies, DNS), which is a fundamentally different (and mostly
          incompatible) job from reading your actual authenticated DOM, so the
          extension doesn't try to capture and scan the signed-in page itself.
          For that, use the &quot;Sign in first&quot; option on the web app's
          scan form, which drives a real login for the scan.
        </p>
      </DocsSection>

      <DocsSection id="settings" title="Settings">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Open the full settings page with the Settings button in the popup's
          footer. Everything above (check families, the port and service sweep,
          auto-scan mode and throttle, notification threshold, card position,
          mute lists, and theme) lives there and is stored locally in the
          browser, not on your account, so it's per-install rather than
          per-user. The sweep is one toggle now, not a per-service list: the old
          per-service panel serialised a <InlineCode>probes</InlineCode> array
          the API had already stopped reading, so configuring it did nothing.
        </p>
      </DocsSection>

      <DocsSection id="permissions" title="Permissions and privacy">
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">
              Runs on every http and https page
            </strong>{" "}
            (content script) so the on-page card and auto-scan work without a
            click first. It reports that a page loaded and, on your device only,
            checks whether the page has a cookie that looks like a sign-in; it
            does not read page content into anything that leaves your browser.
          </li>
          <li>
            <strong className="text-foreground">What it asks for:</strong>{" "}
            <InlineCode>storage</InlineCode>, <InlineCode>tabs</InlineCode> (to
            read a tab's address), <InlineCode>notifications</InlineCode>,{" "}
            <InlineCode>contextMenus</InlineCode> (for &quot;Scan this
            link&quot;), <InlineCode>downloads</InlineCode> (to save an exported
            report), <InlineCode>alarms</InlineCode> (only to keep a long scan
            alive, nothing is scheduled), and access to the {APP_NAME} API
            address. The extension's README lists each one, and a test holds it
            to the manifest.
          </li>
          <li>
            <strong className="text-foreground">Your API key</strong> is stored
            in the browser's local extension storage, sent only to {APP_NAME}
            &apos;s API, and never to any other origin.
          </li>
          <li>
            <strong className="text-foreground">Nothing is scanned</strong>{" "}
            without either you clicking Scan or an auto-scan mode you turned on
            yourself.
          </li>
          <li>
            Fully open source, same license as the rest of {APP_NAME}. Read the
            extension's source in the{" "}
            <a
              href={`https://github.com/${APP_REPO}/tree/main/extension`}
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              extension folder of the GitHub repository
            </a>
            .
          </li>
        </ul>
      </DocsSection>

      <div>
        <Badge variant="outline" className="text-muted-foreground">
          Questions about a specific permission prompt? Ask in the contact form.
        </Badge>
      </div>
    </div>
  );
}
