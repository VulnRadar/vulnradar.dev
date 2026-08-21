// Options page. Loads the user's settings + auth, then renders a
// sticky sidebar nav + a column of 8 sections (Authentication, Auto-
// Scan, Scan Families, Service Probes, Notifications, Appearance,
// Privacy). Every change writes back to chrome.storage.local via the
// settings:set message in the background.
//
// All sections are inline here (rather than split into per-section
// files) for v0.1 - this keeps the surface area small while we figure
// out which sections grow and which get retired.

import { html, render, type TemplateResult } from "lit-html";
import browser from "webextension-polyfill";
import { get, loadAll, saveAll, set } from "../lib/storage";
import { pasteKey, clear as clearAuth, refreshMe } from "../lib/auth";
import { applyTheme } from "../lib/theme";
import { CATEGORIES, PROBES } from "../lib/categories";
import { planLabel } from "../lib/plans";
import { VULNRADAR } from "../lib/constants";
import { api } from "../lib/api";
import { isValidUrlPattern } from "../lib/url-patterns";
import {
  DEFAULT_SETTINGS,
  type AuthState,
  type AuthMe,
  type CardPosition,
  type NotificationThreshold,
  type Settings,
  type ThemeMode,
} from "../lib/types";

const root = document.getElementById("app")!;
// Read from the manifest (filled from package.json at build) so the footer
// version always matches the shipped build instead of a hand-kept constant.
const EXT_VERSION = browser.runtime.getManifest().version;
let currentAuth: AuthState | null = null;
// Fetched once from the public, unauthenticated GET /api/version -- not the
// version of the account you're connected to, but of the VulnRadar instance
// VULNRADAR.apiHost points at. null until the request resolves (or fails).
let appVersion: string | null = null;
let settings: Settings = DEFAULT_SETTINGS;
// Legacy exact-hostname mutes (pre-dates pattern matching) - read-only
// from here on, unmute-only, kept forever so nobody's already-muted site
// silently reappears. All new mutes (this page's own Add button, and the
// on-page card's "Not this site" quick action) write to mutedPatterns.
let mutedHosts: Record<string, true> = {};
let mutedPatterns: string[] = [];
let mutePatternInput = "";
let mutePatternError: string | null = null;
// host -> expiry timestamp (ms), the card's "Snooze 24h" quick action.
// Loaded once on init, same as mutedHosts/mutedPatterns above; expired
// entries are filtered out at render time rather than deleted here (see
// activeSnoozes() below).
let snoozedHosts: Record<string, number> = {};

let activeSection: string = "auth";
let toast: { text: string; ts: number } | null = null;
// True when a key is configured but the last background connectivity
// check failed for a reason other than the key being rejected (see
// auth.ts's RefreshMeResult). Kept separate from `currentAuth` so the
// last-known-good identity still displays while flagging the outage.
let authConnectionFailed = false;
let testStatus:
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; me: AuthMe }
  | { kind: "error"; message: string } = { kind: "idle" };

function showToast(text: string) {
  toast = { text, ts: Date.now() };
  scheduleRender();
}

async function patch(partial: Partial<Settings>) {
  const families: Settings["families"] = partial.families
    ? { ...settings.families, ...partial.families }
    : settings.families;
  const merged: Settings = { ...settings, ...partial, families };
  settings = merged;
  if (partial.theme) applyTheme(partial.theme);
  const storage = await loadAll();
  // Spread the loaded state rather than listing fields. Enumerating them
  // dropped lastResult, and saveAll writes `lastResult ?? null`, so saving
  // any setting wiped the persisted scan result the popup restores on open.
  await saveAll({ ...storage, auth: currentAuth, settings: merged });
  showToast("Saved");
  scheduleRender();
}

async function testConnection(key: string) {
  testStatus = { kind: "loading" };
  scheduleRender();
  try {
    const me = await pasteKey(key);
    currentAuth = { apiKey: key, me };
    authConnectionFailed = false;
    testStatus = { kind: "ok", me };
    showToast("Connected");
  } catch (err) {
    testStatus = {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  scheduleRender();
}

async function unmuteHost(host: string) {
  const next = { ...mutedHosts };
  delete next[host];
  mutedHosts = next;
  await set("mutedHosts", next);
  showToast("Unmuted");
  scheduleRender();
}

async function addMutePatternFromInput() {
  const value = mutePatternInput.trim();
  if (!value) return;
  if (!isValidUrlPattern(value)) {
    mutePatternError =
      "Use one of: https://example.com, https://example.com/*, or https://*.example.com/*";
    scheduleRender();
    return;
  }
  mutePatternError = null;
  if (!mutedPatterns.includes(value)) {
    mutedPatterns = [...mutedPatterns, value];
    await set("mutedPatterns", mutedPatterns);
  }
  mutePatternInput = "";
  showToast("Pattern added");
  scheduleRender();
}

async function removeMutePattern(pattern: string) {
  mutedPatterns = mutedPatterns.filter((p) => p !== pattern);
  await set("mutedPatterns", mutedPatterns);
  showToast("Removed");
  scheduleRender();
}

/** Ends an active snooze early. Direct get()/set() on the `snoozedHosts`
 *  key, never round-tripping the whole settings object - same
 *  storage-key-isolation convention as unmuteHost()/removeMutePattern()
 *  above and snoozeHost() in lib/reputation.ts. */
async function clearSnooze(host: string) {
  const next = { ...snoozedHosts };
  delete next[host];
  snoozedHosts = next;
  await set("snoozedHosts", next);
  showToast("Snooze cleared");
  scheduleRender();
}

/** Non-expired entries from snoozedHosts, sorted by host. Expired entries
 *  are never shown (no "expires in -3h") but are left in storage - they
 *  get pruned on the next write by lib/reputation.ts's snoozeHost(), same
 *  as its own opportunistic-prune comment describes. */
function activeSnoozes(now: number = Date.now()): Array<[string, number]> {
  return Object.entries(snoozedHosts)
    .filter(([, expiresAt]) => expiresAt > now)
    .sort(([a], [b]) => a.localeCompare(b));
}

/** "in 3h" / "in 45m" / "in 2d" - used both for a snoozed host's time
 *  remaining and for the auto-scan pause banner's resume time. */
function formatTimeUntil(ts: number, now: number = Date.now()): string {
  const ms = ts - now;
  if (ms <= 0) return "any moment now";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "in under a minute";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(ms / 86_400_000);
  return `in ${days}d`;
}

/** Shared boolean-setting control - a styled switch instead of a raw
 *  browser checkbox, used for every on/off row across the page. */
function Toggle(
  checked: boolean,
  onChange: (next: boolean) => void,
): TemplateResult {
  return html`
    <label class="switch">
      <input
        type="checkbox"
        .checked=${checked}
        @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span class="switch-track"><span class="switch-thumb"></span></span>
    </label>
  `;
}

async function signOut() {
  if (
    !confirm(
      "Sign out of VulnRadar? You'll need to paste a new API key to scan again.",
    )
  )
    return;
  await clearAuth();
  currentAuth = null;
  authConnectionFailed = false;
  testStatus = { kind: "idle" };
  const input = document.getElementById(
    "api-key-input",
  ) as HTMLInputElement | null;
  if (input) input.value = "";
  showToast("Signed out");
  scheduleRender();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    render(App(), root);
  });
}

// Order matches NAV_GROUPS' flattened order exactly (Account, then
// Scanning, then Alerts, then Preferences) -- this drives both the
// sidebar's scroll-spy target list AND (via the hardcoded Section*() call
// sequence a few lines below) the actual top-to-bottom page order, so the
// two can never silently drift apart again the way they did before: the
// sidebar grouped Site Alerts under "Alerts" (after Scanning), but the
// page rendered it right after Auto-Scan, before Families/Probes -- the
// nav implied one scroll order, the page delivered a different one.
const SECTIONS = [
  { id: "auth", label: "Authentication" },
  { id: "auto", label: "Auto-Scan" },
  { id: "families", label: "Scan Families" },
  { id: "probes", label: "Service Probes" },
  { id: "alerts", label: "Site Alerts" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" },
] as const;

// Purely a sidebar grouping - every id here still has to exist in SECTIONS
// above, which is what setupScrollSpy() and the section id="..." elements
// actually key off. Splitting 8 flat links into labeled clusters gives the
// nav real hierarchy instead of one undifferentiated list.
const NAV_GROUPS: ReadonlyArray<{
  label: string;
  ids: ReadonlyArray<(typeof SECTIONS)[number]["id"]>;
}> = [
  { label: "Account", ids: ["auth"] },
  { label: "Scanning", ids: ["auto", "families", "probes"] },
  { label: "Alerts", ids: ["alerts", "notifications"] },
  { label: "Preferences", ids: ["appearance", "privacy"] },
];

function App(): TemplateResult {
  return html`
    <aside class="sidebar">
      <div class="sidebar-title">
        <img
          src="icons/icon-32.png"
          alt="VulnRadar"
          width="20"
          height="20"
          style="border-radius:4px;display:block;flex-shrink:0"
        />
        VulnRadar
      </div>
      <div class="sidebar-version">
        Extension
        v${EXT_VERSION}${appVersion ? html` &middot; VulnRadar v${appVersion}` : null}
      </div>
      ${NAV_GROUPS.map(
        (group) => html`
          <div class="nav-group-label">${group.label}</div>
          ${group.ids.map((id) => {
            const s = SECTIONS.find((sec) => sec.id === id)!;
            return html`
              <a
                class="nav-item ${activeSection === s.id ? "active" : ""}"
                href="#${s.id}"
                @click=${(e: Event) => {
                  e.preventDefault();
                  activeSection = s.id;
                  scheduleRender();
                  document
                    .getElementById(s.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                >${s.label}</a
              >
            `;
          })}
        `,
      )}
    </aside>
    <div class="content">
      ${SectionAuth()} ${SectionAutoScan()} ${SectionFamilies()}
      ${SectionProbes()} ${SectionSiteAlerts()} ${SectionNotifications()}
      ${SectionAppearance()} ${SectionPrivacy()}
    </div>
    ${
      toast && Date.now() - toast.ts < 3000
        ? html`<div class="toast">${toast.text}</div>`
        : null
    }
  `;
}

// ---- Section: Authentication ----

function SectionAuth(): TemplateResult {
  const me = currentAuth?.me ?? null;
  let banner: TemplateResult | null = null;
  const keyPrefix = currentAuth?.apiKey
    ? currentAuth.apiKey.slice(0, 16) + "\u2026"
    : null;

  if (me && authConnectionFailed) {
    banner = html`
      <div class="status-banner error">
        <span>⚠</span>
        <div>
          <div>
            Failed to connect to VulnRadar. This looks like a problem with the
            API right now, not your key.
          </div>
          <div style="font-size:11px;margin-top:2px;opacity:0.8">
            Last known: <strong>${me.email}</strong> &middot;
            <strong>${planLabel(me.plan)}</strong> plan
          </div>
        </div>
      </div>
    `;
  } else if (me) {
    banner = html`
      <div class="status-banner ok">
        <span>✓</span>
        <div>
          <div>
            Connected as <strong>${me.email}</strong> &middot;
            <strong>${planLabel(me.plan)}</strong> plan
          </div>
          ${keyPrefix ? html`<div style="font-size:11px;margin-top:2px;font-family:var(--vr-mono);opacity:0.7">${keyPrefix}</div>` : null}
        </div>
      </div>
    `;
  } else if (testStatus.kind === "error") {
    banner = html`
      <div class="status-banner error">
        <span>⚠</span>
        <span>${testStatus.message}</span>
      </div>
    `;
  } else {
    banner = html`
      <div class="status-banner info">
        <span>ℹ</span>
        <span
          >Generate an API key at
          <a
            href="${VULNRADAR.apiHost}/profile"
            target="_blank"
            rel="noreferrer"
            >Profile &rsaquo; API Keys</a
          >, then paste it below.</span
        >
      </div>
    `;
  }

  return html`
    <section id="auth" class="section">
      <div class="section-header">
        <div class="section-title">Authentication</div>
        <div class="section-desc">
          The extension authenticates with a VulnRadar API key (Bearer auth).
          Stored in extension storage on this device only, never synced across
          browsers.
        </div>
      </div>
      ${banner}
      <div class="row">
        <div class="row-label">
          <div class="title">API key</div>
          <div class="desc">Format: vr_live_ followed by 64 hex chars</div>
        </div>
        <input
          class="input mono"
          style="min-width:280px"
          placeholder="vr_live_..."
          id="api-key-input"
          @keydown=${async (e: KeyboardEvent) => {
            if (e.key === "Enter") {
              const v = (e.target as HTMLInputElement).value.trim();
              if (v) await testConnection(v);
            }
          }}
        />
        <button
          class="btn primary"
          @click=${async () => {
            const el = document.getElementById(
              "api-key-input",
            ) as HTMLInputElement | null;
            if (el?.value.trim()) await testConnection(el.value.trim());
          }}
          ?disabled=${testStatus.kind === "loading"}
        >
          ${testStatus.kind === "loading" ? "Testing\u2026" : "Test & Save"}
        </button>
      </div>
      ${
        me
          ? html`
              <div class="row">
                <div class="row-label">
                  <div class="title">Sign out</div>
                  <div class="desc">Clear the stored API key</div>
                </div>
                <button class="btn danger" @click=${signOut}>Sign out</button>
              </div>
            `
          : null
      }
    </section>
  `;
}

// ---- Section: Auto-Scan ----

const AUTO_MODES: ReadonlyArray<{
  id: Settings["autoScan"];
  label: string;
  desc: string;
}> = [
  { id: "off", label: "Off", desc: "Manual scans only via the popup" },
  {
    id: "onTabFocus",
    label: "On tab focus",
    desc: "Scan when you focus a tab",
  },
  {
    id: "onPageLoad",
    label: "On page load",
    desc: "Scan every page as it finishes loading",
  },
  {
    id: "onUrlChange",
    label: "On URL change",
    desc: "Scan on navigations (same-origin)",
  },
];

const SCAN_MODES: ReadonlyArray<{
  id: Settings["scanMode"];
  label: string;
  desc: string;
}> = [
  { id: "quick", label: "Quick", desc: "Single page" },
  { id: "deep", label: "Deep", desc: "Crawl same-origin pages" },
];

const PAUSE_DURATIONS: ReadonlyArray<{ label: string; ms: number }> = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "4 hours", ms: 4 * 60 * 60 * 1000 },
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
];

/**
 * Global "stop auto-scanning" switch (Settings.pauseUntil - a timestamp,
 * or null). Distinct from the per-site snooze/mute below it in this file:
 * this affects every site, not one host, and it's the auto-scan pipeline
 * specifically (shouldAutoScanPolicy in lib/scan.ts) - manual scans from
 * the popup or the on-page card still work while paused. Placed as its
 * own banner above the trigger grid rather than another grid row, since
 * it's a single global action, not one choice among several.
 */
function PauseControl(): TemplateResult {
  const now = Date.now();
  const isPaused = settings.pauseUntil !== null && settings.pauseUntil > now;
  if (isPaused) {
    return html`
      <div class="pause-banner active">
        <div>
          <div class="pause-banner-title">Auto-scan is paused</div>
          <div class="pause-banner-desc">
            Resumes ${formatTimeUntil(settings.pauseUntil!)}. Manual scans still
            work.
          </div>
        </div>
        <button class="btn" @click=${() => patch({ pauseUntil: null })}>
          Resume now
        </button>
      </div>
    `;
  }
  return html`
    <div class="pause-banner">
      <div>
        <div class="pause-banner-title">Pause auto-scan</div>
        <div class="pause-banner-desc">
          Stop background scans for a while without changing the trigger below
        </div>
      </div>
      <div class="pause-actions">
        ${PAUSE_DURATIONS.map(
          (d) => html`
            <button
              class="btn"
              @click=${() => patch({ pauseUntil: now + d.ms })}
            >
              ${d.label}
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

function SectionAutoScan(): TemplateResult {
  return html`
    <section id="auto" class="section">
      <div class="section-header">
        <div class="section-title">Auto-Scan</div>
        <div class="section-desc">
          When the extension should automatically scan pages in the background.
          Off by default.
        </div>
      </div>
      ${PauseControl()}
      <div class="subsection-label">Trigger</div>
      <div class="grid">
        ${AUTO_MODES.map(
          (m) => html`
            <label
              class="checkbox ${settings.autoScan === m.id ? "checked" : ""}"
            >
              <input
                type="radio"
                name="autoScan"
                .checked=${settings.autoScan === m.id}
                @change=${() => patch({ autoScan: m.id })}
              />
              <div>
                <div class="name">${m.label}</div>
                <div class="desc">${m.desc}</div>
              </div>
            </label>
          `,
        )}
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <div class="row-label">
          <div class="title">Default scan mode</div>
          <div class="desc">
            Used by auto-scan, the on-page card's "Scan this site", and the
            right-click "Scan this link" menu item. The popup's own Quick/Deep
            toggle always overrides this for a scan you run by hand.
          </div>
        </div>
        <div class="mode-toggle" style="margin-top:8px">
          ${SCAN_MODES.map(
            (m) => html`
              <button
                class="${settings.scanMode === m.id ? "active" : ""}"
                @click=${() => patch({ scanMode: m.id })}
              >
                ${m.label}
              </button>
            `,
          )}
        </div>
      </div>
      <div class="subsection-label">Rate limiting</div>
      <div class="row">
        <div class="row-label">
          <div class="title">Throttle (seconds between scans)</div>
          <div class="desc">
            Prevents burning through your daily quota on tab switching
          </div>
        </div>
        <input
          class="input"
          type="number"
          min="0"
          max="3600"
          style="width:96px"
          .value=${String(settings.autoScanThrottleSeconds)}
          @change=${(e: Event) => {
            const n = Math.max(
              0,
              Math.min(3600, Number((e.target as HTMLInputElement).value)),
            );
            patch({ autoScanThrottleSeconds: n });
          }}
        />
      </div>
      <div class="subsection-label">URL filters</div>
      <div class="row">
        <div
          class="row-label"
          style="flex-direction:column;align-items:stretch"
        >
          <div class="title">Whitelist (one per line, case-insensitive)</div>
          <div class="desc">
            Only auto-scan URLs containing one of these fragments
          </div>
          <textarea
            class="input wide"
            style="margin-top:8px;min-height:64px;font-family:var(--vr-mono);font-size:12px"
            placeholder="https://staging.example.com"
            .value=${settings.whitelist.join("\n")}
            @change=${(e: Event) => {
              const v = (e.target as HTMLTextAreaElement).value;
              const list = v
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              patch({ whitelist: list });
            }}
          ></textarea>
        </div>
      </div>
      <div class="row">
        <div
          class="row-label"
          style="flex-direction:column;align-items:stretch"
        >
          <div class="title">Blacklist (one per line)</div>
          <div class="desc">
            Never auto-scan URLs containing one of these fragments
          </div>
          <textarea
            class="input wide"
            style="margin-top:8px;min-height:64px;font-family:var(--vr-mono);font-size:12px"
            placeholder="*.internal.corp"
            .value=${settings.blacklist.join("\n")}
            @change=${(e: Event) => {
              const v = (e.target as HTMLTextAreaElement).value;
              const list = v
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              patch({ blacklist: list });
            }}
          ></textarea>
        </div>
      </div>
    </section>
  `;
}

// ---- Section: Site Alerts ----

const CARD_POSITIONS: ReadonlyArray<{ id: CardPosition; label: string }> = [
  { id: "top-right", label: "Top right" },
  { id: "top-left", label: "Top left" },
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
];

function SectionSiteAlerts(): TemplateResult {
  const legacyMuted = Object.keys(mutedHosts).sort();
  const snoozes = activeSnoozes();
  return html`
    <section id="alerts" class="section">
      <div class="section-header">
        <div class="section-title">Site Alerts</div>
        <div class="section-desc">
          The small card shown on the page itself when you visit a site:
          VulnRadar's last scan of it if there is one, or a one-click offer to
          scan it if there isn't. Independent of auto-scan above.
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <div class="title">Show results for scanned sites</div>
          <div class="desc">
            The card summarizing VulnRadar's last scan, on a site you've already
            scanned before
          </div>
        </div>
        ${Toggle(settings.showScanResults, (v) =>
          patch({ showScanResults: v }),
        )}
      </div>
      <div class="row">
        <div class="row-label">
          <div class="title">Show scan prompt for new sites</div>
          <div class="desc">
            The one-click "scan this site?" offer, on a site VulnRadar has never
            seen before
          </div>
        </div>
        ${Toggle(settings.showScanPrompts, (v) =>
          patch({ showScanPrompts: v }),
        )}
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <div class="row-label">
          <div class="title">Card position</div>
          <div class="desc">Which screen corner the card appears in</div>
        </div>
        <div class="corner-picker" style="margin-top:8px">
          <div class="corner-picker-screen">
            ${CARD_POSITIONS.map(
              (p) => html`
                <button
                  class="corner-btn corner-${p.id} ${
                    settings.cardPosition === p.id ? "active" : ""
                  }"
                  title=${p.label}
                  aria-label=${p.label}
                  @click=${() => patch({ cardPosition: p.id })}
                ></button>
              `,
            )}
          </div>
          <div class="corner-picker-label">
            ${CARD_POSITIONS.find((p) => p.id === settings.cardPosition)?.label}
          </div>
        </div>
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <div class="row-label">
          <div class="title">Muted URL patterns (${mutedPatterns.length})</div>
          <div class="desc">
            The card won't show on URLs matching these, even with the toggle
            above on. The card's own "Not this site" button adds an exact-origin
            pattern here too.
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input
            class="input wide mono"
            placeholder="https://example.com or https://*.example.com/*"
            .value=${mutePatternInput}
            @input=${(e: Event) => {
              mutePatternInput = (e.target as HTMLInputElement).value;
              if (mutePatternError) mutePatternError = null;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void addMutePatternFromInput();
            }}
          />
          <button class="btn primary" @click=${addMutePatternFromInput}>
            Add
          </button>
        </div>
        ${
          mutePatternError
            ? html`
                <div class="status-banner error" style="margin-top:8px">
                  <span>⚠</span>
                  <span>${mutePatternError}</span>
                </div>
              `
            : null
        }
        ${
          mutedPatterns.length > 0
            ? html`
                <div class="muted-hosts-list" style="margin-top:8px">
                  ${mutedPatterns.map(
                    (p) => html`
                      <div class="muted-host-row">
                        <span class="host">${p}</span>
                        <button
                          class="text-btn"
                          @click=${() => removeMutePattern(p)}
                        >
                          Remove
                        </button>
                      </div>
                    `,
                  )}
                </div>
              `
            : null
        }
      </div>
      ${
        snoozes.length > 0
          ? html`
              <div
                class="row"
                style="flex-direction:column;align-items:stretch"
              >
                <div class="row-label">
                  <div class="title">Snoozed sites (${snoozes.length})</div>
                  <div class="desc">
                    Hosts snoozed for 24h from the card's "Snooze 24h" button.
                    Suppresses the card only for that host, and clears itself
                    once it expires - no need to clear it by hand unless you
                    want the card back sooner.
                  </div>
                </div>
                <div class="muted-hosts-list">
                  ${snoozes.map(
                    ([host, expiresAt]) => html`
                      <div class="muted-host-row">
                        <span class="host">${host}</span>
                        <span class="expiry"
                          >expires ${formatTimeUntil(expiresAt)}</span
                        >
                        <button
                          class="text-btn"
                          @click=${() => clearSnooze(host)}
                        >
                          Clear
                        </button>
                      </div>
                    `,
                  )}
                </div>
              </div>
            `
          : null
      }
      ${
        legacyMuted.length > 0
          ? html`
              <div
                class="row"
                style="flex-direction:column;align-items:stretch"
              >
                <div class="row-label">
                  <div class="title">
                    Muted sites, legacy (${legacyMuted.length})
                  </div>
                  <div class="desc">
                    Muted before URL patterns existed - still honored, but new
                    mutes go in the list above instead
                  </div>
                </div>
                <div class="muted-hosts-list">
                  ${legacyMuted.map(
                    (h) => html`
                      <div class="muted-host-row">
                        <span class="host">${h}</span>
                        <button class="text-btn" @click=${() => unmuteHost(h)}>
                          Unmute
                        </button>
                      </div>
                    `,
                  )}
                </div>
              </div>
            `
          : null
      }
    </section>
  `;
}

// ---- Section: Scan Families ----

function SectionFamilies(): TemplateResult {
  const enabledCount = Object.values(settings.families).filter(Boolean).length;
  return html`
    <section id="families" class="section">
      <div class="section-header">
        <div class="section-title">
          Scan Families
          <span class="count-chip">${enabledCount} / ${CATEGORIES.length}</span>
        </div>
        <div class="section-desc">
          Which scanner categories to run. Disable a family to skip those checks
          entirely (faster scan, no rate-limit usage for them).
        </div>
      </div>
      <div class="families-grid">
        ${CATEGORIES.map(
          (c) => html`
            <label
              class="family-card ${settings.families[c.id] ? "checked" : ""}"
            >
              <div class="family-card-top">
                <input
                  type="checkbox"
                  .checked=${settings.families[c.id]}
                  @change=${(e: Event) => {
                    const next = { ...settings.families };
                    next[c.id] = (e.target as HTMLInputElement).checked;
                    patch({ families: next });
                  }}
                />
                <span class="family-name">${c.label}</span>
              </div>
              <span class="family-id">${c.id}</span>
              <div class="family-desc">${c.description}</div>
            </label>
          `,
        )}
      </div>
    </section>
  `;
}

// ---- Section: Service Probes ----

function SectionProbes(): TemplateResult {
  const enabledCount = Object.values(settings.probes).filter(
    (p) => p.enabled,
  ).length;
  return html`
    <section id="probes" class="section">
      <div class="section-header">
        <div class="section-title">
          Service Probes
          <span class="count-chip">${enabledCount} / ${PROBES.length}</span>
        </div>
        <div class="section-desc">
          Optional banner-grab probes against non-HTTP services on the scanned
          host, run alongside the HTTP-based scan families above. Off by default
          - each one opens a raw TCP connection to the port below.
        </div>
      </div>
      <div class="families-grid">
        ${PROBES.map(
          (p) => html`
            <label
              class="family-card ${settings.probes[p.id].enabled ? "checked" : ""}"
            >
              <div class="family-card-top">
                <input
                  type="checkbox"
                  .checked=${settings.probes[p.id].enabled}
                  @change=${(e: Event) => {
                    const next = { ...settings.probes };
                    next[p.id] = {
                      ...next[p.id],
                      enabled: (e.target as HTMLInputElement).checked,
                    };
                    patch({ probes: next });
                  }}
                />
                <span class="family-name">${p.label}</span>
              </div>
              <span class="family-id">${p.id}</span>
              <div class="family-desc">${p.description}</div>
              <div
                style="display:flex;align-items:center;gap:6px;margin-top:2px"
                @click=${(e: Event) => e.stopPropagation()}
              >
                <span style="font-size:11px;color:var(--vr-text-muted)"
                  >Port</span
                >
                <input
                  class="input mono"
                  type="number"
                  min="1"
                  max="65535"
                  style="width:80px;padding:4px 8px;font-size:12px"
                  .value=${String(settings.probes[p.id].port)}
                  @change=${(e: Event) => {
                    const raw = Number((e.target as HTMLInputElement).value);
                    const port =
                      Number.isFinite(raw) && raw > 0
                        ? Math.max(1, Math.min(65535, Math.round(raw)))
                        : p.defaultPort;
                    const next = { ...settings.probes };
                    next[p.id] = { ...next[p.id], port };
                    patch({ probes: next });
                  }}
                />
              </div>
            </label>
          `,
        )}
      </div>
    </section>
  `;
}

// ---- Section: Notifications ----

const NOTIFY_THRESHOLDS: ReadonlyArray<{
  id: NotificationThreshold;
  label: string;
  desc: string;
}> = [
  { id: "off", label: "Off", desc: "Never notify" },
  {
    id: "critical",
    label: "Critical only",
    desc: "Notify on critical findings",
  },
  { id: "high", label: "High+", desc: "Notify on high or critical" },
  { id: "medium", label: "Medium+", desc: "Notify on medium, high, critical" },
  { id: "all", label: "All", desc: "Notify on any finding" },
];

function SectionNotifications(): TemplateResult {
  return html`
    <section id="notifications" class="section">
      <div class="section-header">
        <div class="section-title">Notifications</div>
        <div class="section-desc">
          When to show a desktop notification after a scan completes.
        </div>
      </div>
      <div class="grid">
        ${NOTIFY_THRESHOLDS.map(
          (n) => html`
            <label
              class="checkbox ${settings.notifyThreshold === n.id ? "checked" : ""}"
            >
              <input
                type="radio"
                name="notifyThreshold"
                .checked=${settings.notifyThreshold === n.id}
                @change=${() => patch({ notifyThreshold: n.id })}
              />
              <div>
                <div class="name">${n.label}</div>
                <div class="desc">${n.desc}</div>
              </div>
            </label>
          `,
        )}
      </div>
      <div class="row">
        <div class="row-label">
          <div class="title">Sound</div>
          <div class="desc">Play a sound with the notification</div>
        </div>
        ${Toggle(settings.notifySound, (v) => patch({ notifySound: v }))}
      </div>
      <div class="row">
        <div class="row-label">
          <div class="title">Open dashboard on click</div>
          <div class="desc">
            Clicking the desktop notification opens the scan in the VulnRadar
            dashboard. Off just dismisses it.
          </div>
        </div>
        ${Toggle(settings.openDashboardOnNotify, (v) =>
          patch({ openDashboardOnNotify: v }),
        )}
      </div>
    </section>
  `;
}

// ---- Section: Appearance ----

const THEMES: ReadonlyArray<{ id: ThemeMode; label: string; desc: string }> = [
  { id: "system", label: "System", desc: "Match OS preference" },
  { id: "light", label: "Light", desc: "Always light" },
  { id: "dark", label: "Dark", desc: "Always dark" },
];

function SectionAppearance(): TemplateResult {
  const activeTheme = THEMES.find((t) => t.id === settings.theme);
  return html`
    <section id="appearance" class="section">
      <div class="section-header">
        <div class="section-title">Appearance</div>
        <div class="section-desc">Theme + density</div>
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <div class="row-label">
          <div class="title">Theme</div>
          <div class="desc">${activeTheme?.desc}</div>
        </div>
        <div class="mode-toggle" style="margin-top:8px">
          ${THEMES.map(
            (t) => html`
              <button
                class="${settings.theme === t.id ? "active" : ""}"
                @click=${() => patch({ theme: t.id })}
              >
                ${t.label}
              </button>
            `,
          )}
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <div class="title">Compact mode</div>
          <div class="desc">Tighter spacing in the popup</div>
        </div>
        ${Toggle(!!settings.compactMode, (v) => patch({ compactMode: v }))}
      </div>
    </section>
  `;
}

// ---- Section: Privacy ----

function SectionPrivacy(): TemplateResult {
  async function clearCache() {
    if (
      !confirm(
        "Clear all locally cached data (API key, settings, scan history)? You will need to paste your API key again. The VulnRadar database is not affected.",
      )
    )
      return;
    await browser.storage.local.clear();
    currentAuth = null;
    authConnectionFailed = false;
    testStatus = { kind: "idle" };
    showToast("Local cache cleared");
    // Reload to reset in-memory state
    setTimeout(() => window.location.reload(), 800);
  }
  return html`
    <section id="privacy" class="section">
      <div class="section-header">
        <div class="section-title">Privacy</div>
        <div class="section-desc">
          What data leaves your browser, and how to wipe it
        </div>
      </div>
      <div class="muted" style="line-height:1.6">
        The extension talks to <strong>${VULNRADAR.apiHost}</strong> only. When
        you click "Scan this page" or auto-scan fires, it sends the current page
        URL to that host. The response (findings, severity counts) is cached in
        <code>extension storage</code> on this device so the popup can show
        recent scans without re-querying. It is never synced across devices.
        <br /><br />
        Nothing is sent to any other origin. The extension has no analytics, no
        telemetry, no third-party scripts.
      </div>
      <div class="row">
        <div class="row-label">
          <div class="title">Clear local cache</div>
          <div class="desc">
            Removes API key, settings, and history from extension storage on
            this device
          </div>
        </div>
        <button class="btn danger" @click=${clearCache}>Clear cache</button>
      </div>
    </section>
  `;
}

// ---- Scroll spy ----

function setupScrollSpy(): void {
  const sectionIds = SECTIONS.map((s) => s.id);
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          if (sectionIds.includes(id as (typeof SECTIONS)[number]["id"])) {
            activeSection = id as (typeof SECTIONS)[number]["id"];
            scheduleRender();
          }
        }
      }
    },
    { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
  );
  for (const id of sectionIds) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
}

// ---- Init ----

async function init() {
  const storage = await loadAll();
  settings = storage.settings;
  currentAuth = storage.auth ?? null;
  mutedHosts = (await get("mutedHosts")) ?? {};
  mutedPatterns = [...((await get("mutedPatterns")) ?? [])];
  snoozedHosts = (await get("snoozedHosts")) ?? {};
  applyTheme(settings.theme);
  scheduleRender();
  // Set up scroll spy after first render
  queueMicrotask(setupScrollSpy);

  // Best-effort: if VULNRADAR.apiHost is unreachable or the request fails,
  // the sidebar just omits the app version rather than showing an error --
  // this is a QoL detail, not something worth a status banner over.
  api
    .version()
    .then((res) => {
      appVersion = res.body.current;
      scheduleRender();
    })
    .catch(() => {
      // appVersion stays null; sidebar shows only the extension version.
    });

  // Re-validate the stored key so a stale "Connected" banner doesn't
  // linger if the key was revoked, or get mistaken for a working
  // connection if VulnRadar's API is simply unreachable right now.
  if (currentAuth) {
    const result = await refreshMe();
    if (result.me) {
      currentAuth = { apiKey: currentAuth.apiKey, me: result.me };
      authConnectionFailed = false;
    } else if (result.connectionFailed) {
      // Keep the last-known-good identity on screen; just flag the outage.
      authConnectionFailed = true;
    } else {
      // Key was rejected (401/403) and already cleared from storage.
      currentAuth = null;
      authConnectionFailed = false;
    }
    scheduleRender();
  }
}

init();
