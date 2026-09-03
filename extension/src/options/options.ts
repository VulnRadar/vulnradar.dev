// Options page. Loads the user's settings + auth, then renders a
// sticky sidebar nav + a column of 8 sections (Authentication, Auto-
// Scan, Scan Families, Port Sweep, Notifications, Appearance,
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
import { applyTheme, watchSystemTheme } from "../lib/theme";
import { CATEGORIES } from "../lib/categories";
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
 *  browser checkbox, used for every on/off row across the page.
 *
 *  `label` is not optional, and that is the point (SC 4.1.2). The <label>
 *  wrapping the input has only the track and thumb inside it, no text, so
 *  every one of the six switches on this page announced as "checkbox, not
 *  checked" with no indication of what it controls: the row title beside it
 *  is a plain <div> that nothing associated with the input. Making the
 *  parameter required means a seventh switch cannot be added without one.
 *  Passed as aria-label rather than by wiring the row's title <div> up with
 *  aria-labelledby, because the titles are not unique across the page
 *  ("Sound" would need a generated id) and several read as fragments out of
 *  their section's context. */
function Toggle(
  label: string,
  checked: boolean,
  onChange: (next: boolean) => void,
): TemplateResult {
  return html`
    <label class="switch">
      <input
        type="checkbox"
        aria-label=${label}
        .checked=${checked}
        @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span class="switch-track"
        ><span class="switch-thumb" aria-hidden="true"></span
      ></span>
    </label>
  `;
}

/**
 * The current value of a section, printed in that section's own heading.
 *
 * Six of the eight sections have exactly one fact you would otherwise have to
 * open the card to learn: which trigger is armed, how many families run, what
 * the notification level is, which theme is set. Two sections already did this
 * and the other six did not, so the page read as eight identical cards with no
 * way in. The state is the thing that differs between them, so it is the thing
 * the eye should catch when scanning down the column.
 *
 * `off` greys the chip. Before this it was a solid brand-blue fill in every
 * case, which drew the word "off" in the most emphatic colour on the page.
 */
function StateChip(label: string, off = false): TemplateResult {
  return html`<span class="count-chip ${off ? "off" : ""}">${label}</span>`;
}

// ---- Confirm dialog ----
//
// The two destructive actions on this page (Sign out, Clear local cache) used
// window.confirm(), the only OS-chrome dialogs anywhere in the extension:
// unstyled, ignoring the theme entirely, and titled with the extension's
// origin. This is the same prompt in the page's own grammar, resolved as a
// promise so the call sites still read top to bottom.
let confirmDialog: {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly danger: boolean;
  readonly resolve: (ok: boolean) => void;
  /** What had focus when the dialog opened, so closing can put it back
   *  (SC 2.4.3). Without this, dismissing the prompt dropped focus on
   *  <body> and a keyboard user restarted from the top of the page: the
   *  Sign out button they had just pressed is eight sections down. */
  readonly returnFocusTo: HTMLElement | null;
} | null = null;

function askConfirm(opts: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  // A second prompt opening while one is pending would strand the first
  // promise forever, so the outgoing one is answered "no" before it is
  // replaced.
  const outgoing = confirmDialog;
  confirmDialog = null;
  outgoing?.resolve(false);
  const opener =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  return new Promise<boolean>((resolve) => {
    confirmDialog = {
      title: opts.title,
      body: opts.body,
      confirmLabel: opts.confirmLabel,
      danger: opts.danger ?? false,
      resolve,
      // Chained prompts keep the ORIGINAL opener, not the first dialog's
      // button, which is gone by the time the second one closes.
      returnFocusTo: outgoing?.returnFocusTo ?? opener,
    };
    scheduleRender();
    // Runs after the render microtask scheduleRender() queued, so the button
    // exists. Focusing it is what makes Enter confirm and Escape cancel
    // without reaching for the mouse, the way window.confirm did.
    queueMicrotask(() => document.getElementById("confirm-accept")?.focus());
  });
}

function closeConfirm(answer: boolean) {
  const pending = confirmDialog;
  confirmDialog = null;
  scheduleRender();
  // After the render that removes the dialog and clears `inert` from the page
  // behind it: focusing an element inside an inert subtree silently no-ops.
  // isConnected guards the case where the opener was itself removed by the
  // action just confirmed (the Sign out row disappears on sign-out).
  queueMicrotask(() => {
    const target = pending?.returnFocusTo;
    if (target?.isConnected) target.focus();
  });
  pending?.resolve(answer);
}

function ConfirmDialog(): TemplateResult | null {
  const d = confirmDialog;
  if (!d) return null;
  return html`
    <div
      class="dialog-backdrop"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) closeConfirm(false);
      }}
    >
      <div
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <div class="dialog-title" id="confirm-title">${d.title}</div>
        <div class="dialog-body" id="confirm-body">${d.body}</div>
        <div class="dialog-actions">
          <button type="button" class="btn" @click=${() => closeConfirm(false)}>
            Cancel
          </button>
          <button
            id="confirm-accept"
            type="button"
            class="btn ${d.danger ? "danger" : "primary"}"
            @click=${() => closeConfirm(true)}
          >
            ${d.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  `;
}

async function signOut() {
  const ok = await askConfirm({
    title: "Sign out of VulnRadar?",
    body: "You'll need to paste a new API key to scan again.",
    confirmLabel: "Sign out",
    danger: true,
  });
  if (!ok) return;
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
  { id: "port-scan", label: "Port Sweep" },
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
  { label: "Scanning", ids: ["auto", "families", "port-scan"] },
  { label: "Alerts", ids: ["alerts", "notifications"] },
  { label: "Preferences", ids: ["appearance", "privacy"] },
];

function App(): TemplateResult {
  // `inert` while the confirm dialog is up. window.confirm() was genuinely
  // modal; an in-page dialog is not, so without this the nav links and every
  // setting behind the backdrop stay clickable and tab-reachable.
  const blocked = confirmDialog !== null;
  return html`
    <!-- a11y (SC 1.3.1/2.4.1): a <nav> landmark, an <h1> and <h2> group
         headings. This was eight settings sections under an <aside> of bare
         <a> and <div> elements, so a screen reader had no landmark to jump to
         and no heading structure to move through - the only way to reach the
         Privacy section was to arrow through everything above it. The image is
         decorative beside the wordmark it sits next to, so alt="" rather than
         repeating "VulnRadar". -->
    <nav class="sidebar" aria-label="Settings sections" ?inert=${blocked}>
      <h1 class="sidebar-title">
        <img
          src="icons/icon-32.png"
          alt=""
          width="20"
          height="20"
          style="border-radius:4px;display:block;flex-shrink:0"
        />
        VulnRadar
      </h1>
      <div class="sidebar-version">
        Extension
        v${EXT_VERSION}${appVersion ? html` &middot; VulnRadar v${appVersion}` : null}
      </div>
      ${NAV_GROUPS.map(
        (group) => html`
          <h2 class="nav-group-label">${group.label}</h2>
          ${group.ids.map((id) => {
            const s = SECTIONS.find((sec) => sec.id === id)!;
            const isActive = activeSection === s.id;
            return html`
              <a
                class="nav-item ${isActive ? "active" : ""}"
                href="#${s.id}"
                aria-current=${isActive ? "true" : "false"}
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
    </nav>
    <div class="content" ?inert=${blocked}>
      ${SectionAuth()} ${SectionAutoScan()} ${SectionFamilies()}
      ${SectionProbes()} ${SectionSiteAlerts()} ${SectionNotifications()}
      ${SectionAppearance()} ${SectionPrivacy()}
    </div>
    <!-- Every setting on this page saves silently and confirms only with this
         toast, so it is the textbook status message (SC 4.1.3). -->
    <div class="toast-region" role="status" aria-live="polite">
      ${
        toast && Date.now() - toast.ts < 3000
          ? html`<div class="toast">${toast.text}</div>`
          : null
      }
    </div>
    ${ConfirmDialog()}
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
      <div class="status-banner error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <div>
            Failed to connect to VulnRadar. This looks like a problem with the
            API right now, not your key.
          </div>
          <div style="font-size:11px;margin-top:2px">
            Last known: <strong>${me.email}</strong> &middot;
            <strong>${planLabel(me.plan)}</strong> plan
          </div>
        </div>
      </div>
    `;
  } else if (me) {
    banner = html`
      <div class="status-banner ok" role="status">
        <span aria-hidden="true">✓</span>
        <div>
          <div>
            Connected as <strong>${me.email}</strong> &middot;
            <strong>${planLabel(me.plan)}</strong> plan
          </div>
          ${keyPrefix ? html`<div style="font-size:11px;margin-top:2px;font-family:var(--vr-mono)">${keyPrefix}</div>` : null}
        </div>
      </div>
    `;
  } else if (testStatus.kind === "error") {
    banner = html`
      <div class="status-banner error" role="alert">
        <span aria-hidden="true">⚠</span>
        <span>${testStatus.message}</span>
      </div>
    `;
  } else {
    banner = html`
      <div class="status-banner info">
        <span aria-hidden="true">ℹ</span>
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
        <h2 class="section-title">
          Authentication
          ${
            me
              ? StateChip(
                  authConnectionFailed
                    ? "Connection failed"
                    : planLabel(me.plan),
                  authConnectionFailed,
                )
              : StateChip("Not connected", true)
          }
        </h2>
        <div class="section-desc">
          The extension authenticates with a VulnRadar API key (Bearer auth).
          Stored in extension storage on this device only, never synced across
          browsers.
        </div>
      </div>
      ${banner}
      <div class="row">
        <div class="row-label">
          <!-- a11y (SC 1.3.1/4.1.2): a real label element bound with "for",
               not a styled div. The placeholder was doing all the naming
               here, and a placeholder is not a label: it disappears the
               moment you type, and where it is exposed as a name at all it
               announces the example value rather than what the field is.
               Same change for the throttle, whitelist, blacklist and
               mute-pattern fields below, which had no name of any kind. -->
          <label class="title" for="api-key-input">API key</label>
          <div class="desc" id="api-key-desc">
            Format: vr_live_ followed by 64 hex chars
          </div>
        </div>
        <input
          class="input mono"
          style="min-width:280px"
          placeholder="vr_live_..."
          id="api-key-input"
          aria-describedby="api-key-desc"
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
              type="button"
              class="btn"
              aria-label=${`Pause auto-scan for ${d.label}`}
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
  const paused =
    settings.pauseUntil !== null && settings.pauseUntil > Date.now();
  const trigger = AUTO_MODES.find((m) => m.id === settings.autoScan);
  return html`
    <section id="auto" class="section">
      <div class="section-header">
        <h2 class="section-title">
          Auto-Scan
          ${
            paused
              ? StateChip("Paused", true)
              : StateChip(trigger?.label ?? "Off", settings.autoScan === "off")
          }
        </h2>
        <div class="section-desc">
          When the extension should automatically scan pages in the background.
          Off by default.
        </div>
      </div>
      ${PauseControl()}
      <h3 class="subsection-label">Trigger</h3>
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
        <!-- a11y (SC 4.1.2): these carried no role and no state attribute at
             all, so which of the two was selected was conveyed only by a fill
             colour. Same shape and same fix as the popup's Quick/Deep pair:
             toggle buttons with aria-pressed inside a labelled group, not a
             tablist, because there are no panels. -->
        <div
          class="mode-toggle"
          style="margin-top:8px"
          role="group"
          aria-label="Default scan mode"
        >
          ${SCAN_MODES.map(
            (m) => html`
              <button
                type="button"
                class="${settings.scanMode === m.id ? "active" : ""}"
                aria-pressed=${settings.scanMode === m.id}
                @click=${() => patch({ scanMode: m.id })}
              >
                ${m.label}
              </button>
            `,
          )}
        </div>
      </div>
      <h3 class="subsection-label">Rate limiting</h3>
      <div class="row">
        <div class="row-label">
          <label class="title" for="throttle-input"
            >Throttle (seconds between scans)</label
          >
          <div class="desc" id="throttle-desc">
            Prevents burning through your daily quota on tab switching
          </div>
        </div>
        <input
          class="input"
          type="number"
          min="0"
          max="3600"
          style="width:96px"
          id="throttle-input"
          aria-describedby="throttle-desc"
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
      <h3 class="subsection-label">URL filters</h3>
      <div class="row">
        <div
          class="row-label"
          style="flex-direction:column;align-items:stretch"
        >
          <label class="title" for="whitelist-input"
            >Whitelist (one per line, case-insensitive)</label
          >
          <div class="desc" id="whitelist-desc">
            Only auto-scan URLs containing one of these fragments
          </div>
          <textarea
            class="input wide"
            style="margin-top:8px;min-height:64px;font-family:var(--vr-mono);font-size:12px"
            placeholder="https://staging.example.com"
            id="whitelist-input"
            aria-describedby="whitelist-desc"
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
          <label class="title" for="blacklist-input"
            >Blacklist (one per line)</label
          >
          <div class="desc" id="blacklist-desc">
            Never auto-scan URLs containing one of these fragments
          </div>
          <textarea
            class="input wide"
            style="margin-top:8px;min-height:64px;font-family:var(--vr-mono);font-size:12px"
            placeholder="*.internal.corp"
            id="blacklist-input"
            aria-describedby="blacklist-desc"
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
  const alertsOn = settings.showScanResults || settings.showScanPrompts;
  return html`
    <section id="alerts" class="section">
      <div class="section-header">
        <h2 class="section-title">
          Site Alerts ${StateChip(alertsOn ? "On" : "Off", !alertsOn)}
        </h2>
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
        ${Toggle(
          "Show results for scanned sites",
          settings.showScanResults,
          (v) => patch({ showScanResults: v }),
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
        ${Toggle(
          "Show scan prompt for new sites",
          settings.showScanPrompts,
          (v) => patch({ showScanPrompts: v }),
        )}
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <div class="row-label">
          <div class="title">Card position</div>
          <div class="desc">Which screen corner the card appears in</div>
        </div>
        <div class="corner-picker" style="margin-top:8px">
          <!-- Four empty buttons in a box: they were individually named but
               nothing said they belonged together, and which one was selected
               was carried only by a fill colour and a scale bump (SC 4.1.2).
               aria-pressed states it. -->
          <div
            class="corner-picker-screen"
            role="group"
            aria-label="Card position"
          >
            ${CARD_POSITIONS.map(
              (p) => html`
                <button
                  type="button"
                  class="corner-btn corner-${p.id} ${
                    settings.cardPosition === p.id ? "active" : ""
                  }"
                  title=${p.label}
                  aria-label=${p.label}
                  aria-pressed=${settings.cardPosition === p.id}
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
          <label class="title" for="mute-pattern-input"
            >Muted URL patterns (${mutedPatterns.length})</label
          >
          <div class="desc" id="mute-pattern-desc">
            The card won't show on URLs matching these, even with the toggle
            above on. The card's own "Not this site" button adds an exact-origin
            pattern here too.
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input
            class="input wide mono"
            placeholder="https://example.com or https://*.example.com/*"
            id="mute-pattern-input"
            aria-describedby="mute-pattern-desc"
            aria-invalid=${mutePatternError ? "true" : "false"}
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
                <div
                  class="status-banner error"
                  style="margin-top:8px"
                  role="alert"
                >
                  <span aria-hidden="true">⚠</span>
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
                          type="button"
                          class="text-btn"
                          aria-label=${`Remove muted pattern ${p}`}
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
                          type="button"
                          class="text-btn"
                          aria-label=${`Clear the snooze on ${host}`}
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
                        <button
                          type="button"
                          class="text-btn"
                          aria-label=${`Unmute ${h}`}
                          @click=${() => unmuteHost(h)}
                        >
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
        <h2 class="section-title">
          Scan Families
          ${StateChip(
            `${enabledCount} / ${CATEGORIES.length}`,
            enabledCount === 0,
          )}
        </h2>
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

// ---- Section: Port Sweep ----

function SectionProbes(): TemplateResult {
  return html`
    <section id="port-scan" class="section">
      <div class="section-header">
        <h2 class="section-title">
          Port Sweep
          ${StateChip(settings.portScan ? "On" : "Off", !settings.portScan)}
        </h2>
        <div class="section-desc">
          A curated sweep of common ports and the services behind them, run
          alongside the HTTP checks above. This replaces the old per-service
          probe list, which the API stopped reading: the extension went on
          sending it, so nothing you set there ever reached a scan. Off by
          default, and the API rejects it unless you have verified ownership of
          the target domain on your ${VULNRADAR.appName} account.
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <div class="title">Run the port and service sweep</div>
          <div class="desc">
            Applied to every scan this extension starts, quick or deep.
          </div>
        </div>
        ${Toggle("Run the port and service sweep", settings.portScan, (v) =>
          patch({ portScan: v }),
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
  const threshold = NOTIFY_THRESHOLDS.find(
    (n) => n.id === settings.notifyThreshold,
  );
  return html`
    <section id="notifications" class="section">
      <div class="section-header">
        <h2 class="section-title">
          Notifications
          ${StateChip(
            threshold?.label ?? "Off",
            settings.notifyThreshold === "off",
          )}
        </h2>
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
        ${Toggle(
          "Play a sound with the notification",
          settings.notifySound,
          (v) => patch({ notifySound: v }),
        )}
      </div>
      <div class="row">
        <div class="row-label">
          <div class="title">Open dashboard on click</div>
          <div class="desc">
            Clicking the desktop notification opens the scan in the VulnRadar
            dashboard. Off just dismisses it.
          </div>
        </div>
        ${Toggle(
          "Open dashboard when a notification is clicked",
          settings.openDashboardOnNotify,
          (v) => patch({ openDashboardOnNotify: v }),
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
        <h2 class="section-title">
          Appearance ${StateChip(activeTheme?.label ?? "System")}
        </h2>
        <div class="section-desc">Theme + density</div>
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <div class="row-label">
          <div class="title">Theme</div>
          <div class="desc">${activeTheme?.desc}</div>
        </div>
        <div
          class="mode-toggle"
          style="margin-top:8px"
          role="group"
          aria-label="Theme"
        >
          ${THEMES.map(
            (t) => html`
              <button
                type="button"
                class="${settings.theme === t.id ? "active" : ""}"
                aria-pressed=${settings.theme === t.id}
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
        ${Toggle("Compact mode", !!settings.compactMode, (v) =>
          patch({ compactMode: v }),
        )}
      </div>
    </section>
  `;
}

// ---- Section: Privacy ----

function SectionPrivacy(): TemplateResult {
  async function clearCache() {
    const ok = await askConfirm({
      title: "Clear all locally cached data?",
      body: "This wipes the API key, settings and scan history stored on this device. You'll need to paste your API key again. Your VulnRadar account and its scan history are not affected.",
      confirmLabel: "Clear local cache",
      danger: true,
    });
    if (!ok) return;
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
        <h2 class="section-title">Privacy</h2>
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
  // applyTheme only resolves "system" once. The options page stays open for a
  // long time, so without this an OS light/dark flip left it on the old theme
  // until reload. Reads settings.theme at event time, so switching to or away
  // from "system" in Appearance needs no re-subscription.
  watchSystemTheme(() => settings.theme);
  // Escape cancels the confirm dialog, which window.confirm gave us for free.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && confirmDialog) {
      e.preventDefault();
      closeConfirm(false);
    }
  });
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
