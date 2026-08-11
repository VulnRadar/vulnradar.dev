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

const SECTIONS = [
  { id: "auth", label: "Authentication" },
  { id: "auto", label: "Auto-Scan" },
  { id: "alerts", label: "Site Alerts" },
  { id: "families", label: "Scan Families" },
  { id: "probes", label: "Service Probes" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" },
] as const;

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
        v${VULNRADAR.version}${appVersion ? html` &middot; VulnRadar v${appVersion}` : null}
      </div>
      ${SECTIONS.map(
        (s) => html`
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
        `,
      )}
    </aside>
    <div class="content">
      ${SectionAuth()} ${SectionAutoScan()} ${SectionSiteAlerts()}
      ${SectionFamilies()} ${SectionProbes()} ${SectionNotifications()}
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
        <div class="grid" style="margin-top:8px">
          ${SCAN_MODES.map(
            (m) => html`
              <label
                class="checkbox ${settings.scanMode === m.id ? "checked" : ""}"
              >
                <input
                  type="radio"
                  name="scanMode"
                  .checked=${settings.scanMode === m.id}
                  @change=${() => patch({ scanMode: m.id })}
                />
                <div>
                  <div class="name">${m.label}</div>
                  <div class="desc">${m.desc}</div>
                </div>
              </label>
            `,
          )}
        </div>
      </div>
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
          <div class="title">Show site alerts</div>
          <div class="desc">
            Turn the on-page card off everywhere. You can also mute it per-site
            from the card itself.
          </div>
        </div>
        <input
          type="checkbox"
          .checked=${settings.siteAlertsEnabled}
          @change=${(e: Event) =>
            patch({
              siteAlertsEnabled: (e.target as HTMLInputElement).checked,
            })}
        />
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <div class="row-label">
          <div class="title">Card position</div>
          <div class="desc">Which screen corner the card appears in</div>
        </div>
        <div class="grid" style="margin-top:8px">
          ${CARD_POSITIONS.map(
            (p) => html`
              <label
                class="checkbox ${settings.cardPosition === p.id ? "checked" : ""}"
              >
                <input
                  type="radio"
                  name="cardPosition"
                  .checked=${settings.cardPosition === p.id}
                  @change=${() => patch({ cardPosition: p.id })}
                />
                <div class="name">${p.label}</div>
              </label>
            `,
          )}
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
        <input
          type="checkbox"
          .checked=${settings.notifySound}
          @change=${(e: Event) =>
            patch({ notifySound: (e.target as HTMLInputElement).checked })}
        />
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
  return html`
    <section id="appearance" class="section">
      <div class="section-header">
        <div class="section-title">Appearance</div>
        <div class="section-desc">Theme + density</div>
      </div>
      <div class="grid">
        ${THEMES.map(
          (t) => html`
            <label class="checkbox ${settings.theme === t.id ? "checked" : ""}">
              <input
                type="radio"
                name="theme"
                .checked=${settings.theme === t.id}
                @change=${() => patch({ theme: t.id })}
              />
              <div>
                <div class="name">${t.label}</div>
                <div class="desc">${t.desc}</div>
              </div>
            </label>
          `,
        )}
      </div>
      <div class="row">
        <div class="row-label">
          <div class="title">Compact mode</div>
          <div class="desc">Tighter spacing in the popup</div>
        </div>
        <input
          type="checkbox"
          .checked=${!!settings.compactMode}
          @click=${(e: Event) =>
            patch({ compactMode: (e.target as HTMLInputElement).checked })}
        />
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
