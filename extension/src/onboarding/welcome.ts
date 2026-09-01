// Onboarding / welcome page. Shown when the user opens the options
// page for the first time and has no API key stored. Step-by-step
// instructions to create + paste a VulnRadar API key.
//
// Deliberately demo-free: the extension requires an authenticated
// VulnRadar account. There is no "try without signing up" path.
// (Compare to /api/v3/demo-scan, which exists in the main app but is
//  not exposed to the extension because anonymous scanning would burn
//  through the wrong rate-limit pool.)

import { html, render, type TemplateResult } from "lit-html";
import browser from "webextension-polyfill";
import { VULNRADAR } from "../lib/constants";

const root = document.getElementById("app")!;

function App(): TemplateResult {
  return html`
    <div class="welcome">
      <div class="welcome-hero">
        <img
          class="logo-icon"
          src="icons/icon-48.png"
          width="48"
          height="48"
          alt="VulnRadar"
        />
        <h1>Welcome to VulnRadar</h1>
        <p class="tagline">
          One-click vulnerability scanning for any website you visit.
        </p>
      </div>

      <!-- a11y (SC 1.3.1): the step headings were h3 directly under the h1
           above, skipping h2, and the big numbered circle beside each one is
           decorative: the ordered list already conveys the sequence, so
           reading "1" out loud before every heading is noise. -->
      <ol class="steps">
        <li class="step">
          <div class="step-num" aria-hidden="true">1</div>
          <div class="step-body">
            <h2>Create an account</h2>
            <p>
              Sign up at
              <a href="${VULNRADAR.apiHost}" target="_blank" rel="noreferrer"
                >${VULNRADAR.apiHost}</a
              >
              if you don't already have one. The free tier includes 25 scans /
              day.
            </p>
          </div>
        </li>

        <li class="step">
          <div class="step-num" aria-hidden="true">2</div>
          <div class="step-body">
            <h2>Generate an API key</h2>
            <p>
              Go to
              <a
                href="${VULNRADAR.apiHost}/profile"
                target="_blank"
                rel="noreferrer"
                >Profile › API Keys</a
              >
              and click <strong>Generate New Key</strong>. Copy the
              <code>vr_live_...</code> value.
            </p>
          </div>
        </li>

        <li class="step">
          <div class="step-num" aria-hidden="true">3</div>
          <div class="step-body">
            <h2>Paste it here</h2>
            <p>
              Open
              <button type="button" class="link" @click=${openOptions}>
                Settings
              </button>
              (or right-click the toolbar icon › Options) and paste the key. The
              extension verifies it against
              <code>/api/v3/auth/me</code> before saving.
            </p>
          </div>
        </li>
      </ol>

      <div class="privacy-callout">
        <strong>Privacy:</strong> the key is stored in
        <code>extension storage</code> on this device only. It is never sent
        anywhere except <code>${VULNRADAR.apiHost}</code> as a Bearer token. No
        telemetry, no analytics, no third-party scripts.
      </div>

      <div class="actions">
        <button type="button" class="btn primary" @click=${openOptions}>
          Open Settings
        </button>
      </div>
    </div>
  `;
}

async function openOptions() {
  await browser.runtime.openOptionsPage();
}

function injectStyles() {
  if (document.getElementById("vr-welcome-styles")) return;
  const s = document.createElement("style");
  s.id = "vr-welcome-styles";
  s.textContent = `
    /* welcome.html links popup.css for the token variables, and popup.css
       clamps html/body to a 360-480px toolbar popup. This page is a full
       browser tab, so without the reset below its 640px column was squeezed
       into 480px and pinned to the left edge of the window. */
    html, body {
      min-width: 0;
      max-width: none;
    }
    body {
      background: var(--vr-bg);
      color: var(--vr-text);
    }
    .welcome {
      max-width: 640px;
      margin: 0 auto;
      padding: 40px 24px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }
    .welcome-hero {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .logo-icon {
      width: 48px;
      height: 48px;
      border-radius: 10px;
      display: block;
      margin-bottom: 8px;
    }
    .welcome-hero h1 {
      font-size: 24px;
      font-weight: 700;
      margin: 0;
    }
    .tagline {
      color: var(--vr-text-muted);
      font-size: 14px;
      max-width: 480px;
      margin: 0;
    }
    .steps {
      display: flex;
      flex-direction: column;
      gap: 16px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .step {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }
    .step-num {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--vr-primary);
      color: var(--vr-primary-fg);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 14px;
    }
    .step-body {
      flex: 1;
    }
    .step-body h2 {
      font-size: 15px;
      font-weight: 600;
      margin: 0 0 4px;
    }
    .step-body p {
      font-size: 13px;
      color: var(--vr-text-muted);
      line-height: 1.5;
      margin: 0;
    }
    .step-body code {
      font-family: var(--vr-mono);
      font-size: 11px;
      background: var(--vr-card);
      padding: 1px 5px;
      border-radius: 3px;
    }
    .link {
      font: inherit;
      /* --vr-primary is the button fill and reads 2.0:1 as text on the light
         theme; --vr-primary-text is the same hue at an AA lightness. */
      color: var(--vr-primary-text);
      text-decoration: underline;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
    }
    .privacy-callout {
      padding: 12px 16px;
      background: var(--vr-card);
      border: 1px solid var(--vr-border);
      border-radius: var(--vr-radius);
      font-size: 12px;
      color: var(--vr-text-muted);
      line-height: 1.5;
    }
    .privacy-callout code {
      font-family: var(--vr-mono);
      font-size: 11px;
      background: transparent;
      padding: 0;
    }
    .privacy-callout strong {
      color: var(--vr-text);
    }
    .actions {
      display: flex;
      justify-content: center;
    }
    .btn {
      font: inherit;
      padding: 10px 20px;
      border-radius: var(--vr-radius);
      border: 1px solid var(--vr-input);
      background: var(--vr-bg);
      color: var(--vr-text);
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    }
    .btn.primary {
      background: var(--vr-primary);
      color: var(--vr-primary-fg);
      border-color: var(--vr-primary);
    }
  `;
  document.head.appendChild(s);
}

injectStyles();
render(App(), root);
