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
        <div class="logo-dot"></div>
        <h1>Welcome to VulnRadar</h1>
        <p class="tagline">
          One-click vulnerability scanning for any website you visit.
        </p>
      </div>

      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-body">
            <h3>Create an account</h3>
            <p>
              Sign up at
              <a
                href="${VULNRADAR.apiHost}"
                target="_blank"
                rel="noreferrer"
                >${VULNRADAR.apiHost}</a
              >
              if you don't already have one. The free tier includes 25
              scans / day.
            </p>
          </div>
        </div>

        <div class="step">
          <div class="step-num">2</div>
          <div class="step-body">
            <h3>Generate an API key</h3>
            <p>
              Go to
              <a
                href="${VULNRADAR.apiHost}/profile"
                target="_blank"
                rel="noreferrer"
                >Profile \u203a API Keys</a
              >
              and click <strong>Generate New Key</strong>. Copy the
              <code>vr_live_...</code> value.
            </p>
          </div>
        </div>

        <div class="step">
          <div class="step-num">3</div>
          <div class="step-body">
            <h3>Paste it here</h3>
            <p>
              Open
              <button class="link" @click=${openOptions}>Settings</button>
              (or right-click the toolbar icon \u203a Options) and paste
              the key. The extension verifies it against
              <code>/api/v3/auth/me</code> before saving.
            </p>
          </div>
        </div>
      </div>

      <div class="privacy-callout">
        <strong>Privacy:</strong> the key is stored in
        <code>extension storage</code> on this device only. It is
        never sent anywhere except
        <code>${VULNRADAR.apiHost}</code> as a Bearer token. No
        telemetry, no analytics, no third-party scripts.
      </div>

      <div class="actions">
        <button class="btn primary" @click=${openOptions}>
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
    .logo-dot {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--vr-primary);
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
    .step-body h3 {
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
      color: var(--vr-primary);
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
      border: 1px solid var(--vr-border);
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
