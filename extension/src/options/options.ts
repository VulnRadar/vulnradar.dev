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
import { loadAll, saveAll } from "../lib/storage";
import { pasteKey, clear as clearAuth } from "../lib/auth";
import { applyTheme } from "../lib/theme";
import { CATEGORIES } from "../lib/categories";
import { VULNRADAR } from "../lib/constants";
import { DEFAULT_SETTINGS, type AuthState, type AuthMe, type NotificationThreshold, type ScanMode, type Settings, type ThemeMode } from "../lib/types";

const root = document.getElementById("app")!;
let currentAuth: AuthState | null = null;
let settings: Settings = DEFAULT_SETTINGS;

let activeSection: string = "auth";
let toast: { text: string; ts: number } | null = null;
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
  await saveAll({
    schemaVersion: 1,
    auth: currentAuth,
    settings: merged,
    historyCache: storage.historyCache,
    lastAutoScanAt: storage.lastAutoScanAt,
    rateLimitInfo: storage.rateLimitInfo ?? null,
  });
  showToast("Saved");
  scheduleRender();
}

async function testConnection(key: string) {
  testStatus = { kind: "loading" };
  scheduleRender();
  try {
    const me = await pasteKey(key);
    currentAuth = { apiKey: key, me };
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

async function signOut() {
  if (
    !confirm(
      "Sign out of VulnRadar? You'll need to paste a new API key to scan again.",
    )
  )
    return;
  await clearAuth();
  currentAuth = null;
  testStatus = { kind: "idle" };
  const input = document.getElementById("api-key-input") as HTMLInputElement | null;
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
  { id: "families", label: "Scan Families" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" },
] as const;

function App(): TemplateResult {
  return html`
    <aside class="sidebar">
      <div class="sidebar-title">
        <img src="icons/icon-32.png" alt="VulnRadar" width="20" height="20" style="border-radius:4px;display:block;flex-shrink:0">
        VulnRadar
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
      ${SectionAuth()}
      ${SectionAutoScan()}
      ${SectionFamilies()}
      ${SectionNotifications()}
      ${SectionAppearance()}
      ${SectionPrivacy()}
    </div>
    ${toast && Date.now() - toast.ts < 3000
      ? html`<div class="toast">${toast.text}</div>`
      : null}
  `;
}

// ---- Section: Authentication ----

function SectionAuth(): TemplateResult {
  const me = currentAuth?.me ?? null;
  let banner: TemplateResult | null = null;
  const keyPrefix = currentAuth?.apiKey
    ? currentAuth.apiKey.slice(0, 16) + "\u2026"
    : null;

  if (me) {
    banner = html`
      <div class="status-banner ok">
        <span>\u2713</span>
        <div>
          <div>Connected as <strong>${me.email}</strong> &middot; <strong>${me.plan}</strong> plan</div>
          ${keyPrefix ? html`<div style="font-size:11px;margin-top:2px;font-family:var(--vr-mono);opacity:0.7">${keyPrefix}</div>` : null}
        </div>
      </div>
    `;
  } else if (testStatus.kind === "error") {
    banner = html`
      <div class="status-banner error">
        <span>\u26a0</span>
        <span>${testStatus.message}</span>
      </div>
    `;
  } else {
    banner = html`
      <div class="status-banner info">
        <span>\u2139</span>
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
          Stored in extension storage on this device only, never synced across browsers.
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
      ${me
        ? html`
            <div class="row">
              <div class="row-label">
                <div class="title">Sign out</div>
                <div class="desc">Clear the stored API key</div>
              </div>
              <button class="btn danger" @click=${signOut}>Sign out</button>
            </div>
          `
        : null}
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

function SectionAutoScan(): TemplateResult {
  return html`
    <section id="auto" class="section">
      <div class="section-header">
        <div class="section-title">Auto-Scan</div>
        <div class="section-desc">
          When the extension should automatically scan pages in the
          background. Off by default.
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
        <div class="row-label" style="flex-direction:column;align-items:stretch">
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
        <div class="row-label" style="flex-direction:column;align-items:stretch">
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

// ---- Section: Scan Families ----

function SectionFamilies(): TemplateResult {
  return html`
    <section id="families" class="section">
      <div class="section-header">
        <div class="section-title">Scan Families (${CATEGORIES.length})</div>
        <div class="section-desc">
          Which scanner categories to run. Disable a family to skip
          those checks (faster scans, no rate-limit usage for them).
        </div>
      </div>
      <div class="grid">
        ${CATEGORIES.map(
          (c) => html`
            <label
              class="checkbox ${settings.families[c.id] ? "checked" : ""}"
              title=${c.description}
            >
              <input
                type="checkbox"
                .checked=${settings.families[c.id]}
                @change=${(e: Event) => {
                  const next = { ...settings.families };
                  next[c.id] = (e.target as HTMLInputElement).checked;
                  patch({ families: next });
                }}
              />
              <div>
                <div class="name-row">
                  <span class="name">${c.label}</span>
                  <span class="pill">${c.id}</span>
                </div>
                <div class="desc">${c.description}</div>
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
  { id: "critical", label: "Critical only", desc: "Notify on critical findings" },
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
            <label
              class="checkbox ${settings.theme === t.id ? "checked" : ""}"
            >
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
          .checked=${settings.compactMode}
          @change=${(e: Event) =>
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
    testStatus = { kind: "idle" };
    showToast("Local cache cleared");
    // Reload to reset in-memory state
    setTimeout(() => window.location.reload(), 800);
  }
  return html`
    <section id="privacy" class="section">
      <div class="section-header">
        <div class="section-title">Privacy</div>
        <div class="section-desc">What data leaves your browser, and how to wipe it</div>
      </div>
      <div class="muted" style="line-height:1.6">
        The extension talks to <strong>${VULNRADAR.apiHost}</strong> only.
        When you click "Scan this page" or auto-scan fires, it sends
        the current page URL to that host. The response (findings, severity counts)
        is cached in <code>extension storage</code> on this device so the popup
        can show recent scans without re-querying. It is never synced across devices.
        <br /><br />
        Nothing is sent to any other origin. The extension has no
        analytics, no telemetry, no third-party scripts.
      </div>
      <div class="row">
        <div class="row-label">
          <div class="title">Clear local cache</div>
          <div class="desc">
            Removes API key, settings, and history from extension storage on this device
          </div>
        </div>
        <button class="btn danger" @click=${clearCache}>Clear cache</button>
      </div>
    </section>
  `;
}

// ---- Init ----

async function init() {
  const storage = await loadAll();
  settings = storage.settings;
  currentAuth = storage.auth ?? null;
  applyTheme(settings.theme);
  scheduleRender();
}

init();
