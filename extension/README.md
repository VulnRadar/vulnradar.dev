# VulnRadar Browser Extension

One-click vulnerability scanning for any website you visit, powered by [VulnRadar](https://vulnradar.dev).

- **Click the toolbar icon** to scan the current page
- **Optional auto-scan** when a tab loads / changes
- **12 check families** + **6 service probes** configurable per family
- All requests go to `https://vulnradar.dev/api/v3/*` using your VulnRadar **API key** (Bearer auth)

## Install (development build)

### Build from source

```bash
cd extension
npm install
npm run icons            # one-time: generates 16/32/48/128 PNGs from public/favicon.svg
npm run build:chrome     # builds dist-chrome/
npm run build:firefox    # builds dist-firefox/
```

Or build both at once:

```bash
npm run build
```

For store submission, also run:

```bash
npm run package         # zips dist-{chrome,firefox} into vulnradar-{browser}-v0.1.2.zip
```

### Chrome (Chromium / Edge / Brave / Arc / Opera)

1. Open `chrome://extensions/`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist-chrome/` folder (NOT `dist-build/`)
5. Pin the **VulnRadar** icon: puzzle-piece menu → pin
6. Click the icon → the **Options** page opens in a new tab
7. Paste your API key from `https://vulnradar.dev/profile` (Profile → API Keys → Generate New Key, copy the `vr_live_…` value)
8. Click **Test connection**: should turn green with your email and plan
9. Save
10. Visit any website → click the toolbar icon → **Scan this page** → result panel

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **This Firefox** → **Load Temporary Add-on**
3. Select `extension/dist-firefox/manifest.json` (NOT `dist-build/`)
4. Pin the **VulnRadar** icon to the toolbar
5. Same flow as Chrome from step 6 onward

> **Firefox note:** Temporary add-ons are removed when Firefox restarts. For permanent install, submit the zipped build to [addons.mozilla.org](https://addons.mozilla.org/developers/addon/submit/) (after Mozilla review).

### Safari

Not supported in v0.1. Safari Web Extensions require a separate Xcode project + native shim.

## First run

1. Click the VulnRadar icon in the toolbar
2. The **Connect VulnRadar** pill says "Not connected" with a red dot
3. Click the link or open **Options** to paste your API key
4. After saving, the pill turns green with "user@example.com (Pro plan, 142/150 left)"
5. Now any click on the icon shows the popup with the current page URL and a **Scan** button

## How to use

### Popup (click the toolbar icon)

- **Connect pill** (top): shows your login status, plan, remaining quota
- **URL pill** (middle): the current page URL, copy button
- **Mode + families + Scan button**: Quick / Deep toggle, family count chip, big Scan button
- **Result panel**: severity badges (Critical/High/Medium/Low/Info), finding list with fix snippets, "Open in Dashboard" link

### Options (right-click the icon → Options, or click the link in the popup)

8 sections, left rail nav or stacked accordions:

1. **Authentication**: paste API key, "Test connection", "Create API key" link to dashboard, "Sign out"
2. **Auto-Scan**: off / on-tab-focus / on-page-load / on-URL-change, throttle seconds, whitelist/blacklist patterns
3. **Scan Families**: 12 checkboxes with "what this checks" tooltips
4. **Service Probes**: 6 checkboxes + per-probe port inputs (ssh/smtp/imap/pop3/ftp/mongodb)
5. **Schedule**: one-time / daily / weekly scan schedule + "scan on every browser launch" toggle
6. **Notifications**: severity threshold dropdown, sound checkbox, click-to-open-dashboard toggle
7. **Appearance**: light / dark / system theme, compact mode
8. **Privacy**: "What data leaves my browser" disclosure, "Clear local cache" button, "Reset all settings" link

## Permissions

| Permission                                   | Why                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `storage`                                    | Save API key, preferences, scan history cache in `chrome.storage.local` |
| `alarms`                                     | Scheduled scans (one-time / daily / weekly)                             |
| `notifications`                              | "Scan complete" toasts when threshold met                               |
| `tabs`                                       | Read current tab URL, query active tab for popup                        |
| `activeTab`                                  | Minimal-scope current-tab access for popup → background comms           |
| `scripting`                                  | On-demand content script injection (for auto-scan)                      |
| `<all_urls>` (content_scripts)               | Run scan on every page the user visits                                  |
| `https://vulnradar.dev/*` (host_permissions) | API calls to your VulnRadar instance                                    |

**No data is sent to any other origin.** The extension talks to `vulnradar.dev` (or whatever you configure) and that's it.

## Publishing (optional)

Once you're happy with v0.1:

- **Chrome Web Store:** $5 one-time dev fee. Upload `vulnradar-chrome-v0.1.2.zip` at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole/). Requires 128x128 + 440x280 promo tile + 1280x720 screenshot.
- **Firefox AMO:** Free. Upload `vulnradar-firefox-v0.1.2.zip` at [addons.mozilla.org/developers/addon/submit](https://addons.mozilla.org/developers/addon/submit/). Mozilla review takes a few days.

## Project structure

```
extension/
├── package.json              ← deps + scripts
├── tsconfig.json             ← strict TS
├── vite.config.ts            ← multi-entry build (background, content, popup, options, welcome)
├── .gitignore
├── manifest/
│   ├── chrome.json           ← MV3 (no gecko block)
│   └── firefox.json          ← MV3 + gecko.strict_min_version: "109.0"
├── scripts/
│   ├── build.mjs             ← vite + per-target manifest inject
│   ├── generate-icons.mjs    ← sharp: SVG → 16/32/48/128 PNGs
│   └── package.mjs           ← zip dist-{chrome,firefox} for store upload
├── public/
│   ├── favicon.svg            ← source (copy from main repo)
│   └── icons/                 ← generated PNGs
└── src/                       (built by Vite into dist-build/, then copied to dist-{chrome,firefox}/)
    ├── lib/                  ← api, auth, storage, types, categories, format, theme
    ├── background/           ← service worker, alarms
    ├── content/              ← detector (page metadata)
    ├── popup/                ← html + css + ts + components
    ├── options/              ← html + css + ts + 8 section components
    └── onboarding/           ← welcome.html (demo-free)
```

## Validation

```bash
cd extension
npm run typecheck          # tsc --noEmit
npm run format:check       # prettier
```

(Gates that apply to the main repo, tsc, eslint, build, also work on `extension/`. The extension ships its own minimal configs to avoid dragging in Next.js / React conventions.)

## License

GPL-3.0, same as the main VulnRadar project.
