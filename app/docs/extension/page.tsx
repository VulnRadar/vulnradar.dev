"use client";

import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  APP_NAME,
  RELEASES_URL,
  ROUTES,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "@/components/docs/docs-shell";
import {
  DocsHero,
  DocsSection,
  DocsSteps,
  DocsCallout,
  InlineCode,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "install", label: "Install" },
  { id: "scanning", label: "Scanning from the popup" },
  { id: "reputation-card", label: "The on-page card" },
  { id: "auto-scan", label: "Auto-scan modes" },
  { id: "signed-in-pages", label: "Pages you're signed into" },
  { id: "settings", label: "Settings" },
  { id: "permissions", label: "Permissions and privacy" },
];

export default function ExtensionPage() {
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
        <DocsCallout variant="info" title="Store listings pending review">
          Chrome Web Store and Firefox Add-ons submissions are in progress.
          Until those are approved, install from the packaged release below.
        </DocsCallout>

        <DocsSteps
          steps={[
            {
              step: 1,
              title: "Download the latest release",
              description: `Grab vulnradar-chrome-vX.Y.Z.zip or vulnradar-firefox-vX.Y.Z.zip from the GitHub releases page and unzip it.`,
            },
            {
              step: 2,
              title: "Load it unpacked",
              description:
                "Chrome/Edge: chrome://extensions -> enable Developer mode -> Load unpacked -> select the unzipped folder. Firefox: about:debugging#/runtime/this-firefox -> Load Temporary Add-on -> select any file inside the folder.",
            },
            {
              step: 3,
              title: "Connect your account",
              description:
                "Click the toolbar icon, then Open Settings. Generate an API key from your VulnRadar profile and paste it in - the extension authenticates as you from then on.",
            },
          ]}
        />

        <p className="text-sm text-muted-foreground">
          Need an API key first? Generate one from{" "}
          <InlineCode>{ROUTES.PROFILE}#api-keys</InlineCode> while logged in.
        </p>
      </DocsSection>

      <DocsSection id="scanning" title="Scanning from the popup">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Click the toolbar icon on any page and hit Scan. Quick and Deep mirror
          the same two modes on the web app's scan form: Quick runs the fast
          header/TLS/content family checks, Deep also crawls linked pages on the
          same host. Which check families run is controlled from the extension's
          own Settings, independent of your web app defaults, so you can keep
          the popup fast day-to-day and still reach every check when you want
          it.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A scan started from the popup counts against the same daily limit as
          any other scan on your account and shows up in your regular scan
          history: there's no separate extension-only history to lose track of.
        </p>
      </DocsSection>

      <DocsSection id="reputation-card" title="The on-page card">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          When enabled, a small card can appear in the corner of a page
          reporting one of two things: this host has been scanned before (and
          what its last result was), or it hasn't and you can scan it now. Site
          alerts are entirely separate from auto-scan below: this is about
          surfacing information, not triggering a scan on its own.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Doesn't repeat itself:</strong>{" "}
            once you've seen the card for a host, it stays quiet on later page
            loads and tab switches to that same host for 24 hours, unless a new
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
      </DocsSection>

      <DocsSection id="auto-scan" title="Auto-scan modes">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Off by default. Three modes decide when a scan fires without you
          clicking anything:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              name: "On page load",
              description:
                "Scans a host the first time you land on it, throttled per host so repeat navigation on the same site doesn't re-trigger.",
            },
            {
              name: "On tab focus",
              description:
                "Scans when you switch to a tab showing a host that hasn't been checked recently, not on every load.",
            },
            {
              name: "On URL change",
              description:
                "Follows SPA/client-side navigation within a site, not just full page loads.",
            },
          ].map((mode) => (
            <Card key={mode.name} className="p-4 border-border/50 bg-card/50">
              <p className="text-sm font-medium text-foreground mb-2">
                {mode.name}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {mode.description}
              </p>
            </Card>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          A whitelist/blacklist and a global pause are available in Settings for
          hosts or stretches of time you never want auto-scanned, regardless of
          mode.
        </p>
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
          Open the full settings page from the popup's gear icon. Everything
          above (check families, service probes, auto-scan mode and throttle,
          notification threshold, card position, mute lists, and theme) lives
          there and is stored locally in the browser, not on your account, so
          it's per-install rather than per-user.
        </p>
      </DocsSection>

      <DocsSection id="permissions" title="Permissions and privacy">
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Runs on every page</strong>{" "}
            (content script) so the on-page card and auto-scan work without a
            click first. It reads the page's URL and a same-origin session
            cookie name check; it does not read page content into anything that
            leaves your browser.
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
              href={RELEASES_URL}
              className="text-primary underline-offset-2 hover:underline"
            >
              GitHub repository
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
