# VulnRadar Browser Extension

One-click vulnerability scanning for any website you visit, powered by [VulnRadar](https://vulnradar.dev).

- **Click the toolbar icon** to scan the current page
- **Optional auto-scan** when a tab loads / changes
- **18 check families** + **6 service probes** configurable per family
- **Expand any finding** for the evidence, why it matters, and the steps to fix it
- **Export a scan** as PDF, SARIF, Markdown, or JSON, straight from the popup
- **Scan history per site**, with a trend against the previous scan and one-click rescan
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

Or build both at once, already zipped and ready for store submission --
`npm run build` chains build.mjs (both targets), package.mjs (zips
dist-{chrome,firefox} into `vulnradar-{browser}-vX.Y.Z.zip`), and
package-source.mjs (zips this whole directory into
`vulnradar-extension-vX.Y.Z-source.zip`, which AMO review asks for
alongside the built package) into one step, no separate commands needed:

```bash
npm run build
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
3. **Scan Families**: 18 checkboxes with "what this checks" tooltips
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

## Publishing

- **Chrome Web Store:** live. Upload `vulnradar-chrome-vX.Y.Z.zip` at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole/) for each new release.
- **Firefox AMO:** live as of 2026-08-15, at [addons.mozilla.org/firefox/addon/vulnradar-website-scanner](https://addons.mozilla.org/en-US/firefox/addon/vulnradar-website-scanner/). Upload `vulnradar-firefox-vX.Y.Z.zip` at [addons.mozilla.org/developers/addon/submit](https://addons.mozilla.org/developers/addon/submit/) for each new release; Mozilla review takes a few days.

## Project structure

```
extension/
├── package.json              ← deps + scripts
├── package-lock.json         ← own lockfile, separate from the repo root's
├── tsconfig.json             ← strict TS (covers src/, scripts/, vite.config.ts)
├── vite.config.ts            ← page build only (popup, options, welcome)
├── vitest.config.ts          ← runs tests/ with the repo root's vitest binary
├── LICENSE                   ← GPL-3.0, copied into every build output
├── THIRD-PARTY.md            ← MPL-2.0 / BSD-3 notices, also copied in
├── .gitignore
├── manifest/
│   ├── chrome.json           ← MV3 (no gecko block)
│   └── firefox.json          ← MV3 + gecko.strict_min_version: "140.0"
├── scripts/
│   ├── build.mjs             ← vite pages + IIFE background/content + manifest inject
│   ├── gen-tokens.mjs        ← src/lib/tokens.json → src/tokens.css
│   ├── generate-icons.mjs    ← sharp: SVG → 16/32/48/128 PNGs
│   ├── package.mjs           ← zip dist-{chrome,firefox} for store upload
│   └── package-source.mjs    ← zip the source tree for AMO review
├── public/                    (copied verbatim into every build)
│   ├── favicon.svg            ← source (copy from main repo)
│   └── icons/                 ← generated PNGs
├── store-assets/              ← Chrome Web Store / AMO listing screenshots.
│                                Deliberately NOT under public/, which Vite
│                                copies into the shipped package.
├── tests/                     ← vitest suites for the pure lib/ modules
└── src/                       (built by Vite into dist-build/, then copied to dist-{chrome,firefox}/)
    ├── popup.html            ← popup entry document
    ├── popup.css             ← popup styles (imports the generated tokens.css)
    ├── options.html          ← options entry document
    ├── options.css           ← options styles (imports popup.css)
    ├── welcome.html          ← onboarding entry document
    ├── tokens.css            ← GENERATED by gen-tokens.mjs, do not hand-edit
    ├── vite-env.d.ts         ← Vite client types
    ├── lib/                  ← api, auth, storage, types, constants,
    │                           categories, format, theme, tokens, badge,
    │                           messaging, plans, reputation, scan,
    │                           scan-lifecycle, scan-target, url-patterns
    │                           (plus tokens.json, the gen-tokens.mjs source)
    ├── background/           ← service-worker.ts (messages, alarms, auto-scan)
    ├── content/              ← detector.ts, reputation-card.ts (shadow-DOM card)
    ├── popup/                ← popup.ts + components/ (connect-pill, scan-button)
    ├── options/              ← options.ts (all sections inline, see its header)
    └── onboarding/           ← welcome.ts
```

`background.js` and `content.js` are built separately by `scripts/build.mjs`
as self-contained IIFE bundles, not by `vite.config.ts`: the manifest injects
them as classic scripts, so a top-level `import` from a shared chunk would be
a load-time SyntaxError. The comment at the top of `vite.config.ts` has the
full reasoning.

## Validation

```bash
cd extension
npm run typecheck          # tsc --noEmit
npm run format:check       # prettier
```

(Gates that apply to the main repo, tsc, eslint, build, also work on `extension/`. The extension ships its own minimal configs to avoid dragging in Next.js / React conventions.)

**The extension type-checks with its own TypeScript, and it is a major behind
the app's.** `extension/package.json` declares `typescript@^5.7.2` while the
repo root pins `6.0.3`, and `npm run typecheck` here resolves the extension's
copy. The root's `@typescript-eslint` peer range is what holds the root back
from moving further, and the extension has simply not been moved forward yet.
Two consequences worth knowing before you spend an hour on a phantom error:
an editor opened at the repo root resolves the root's 6.0.3 for these files,
so it can report diagnostics CI never produces (and miss ones it does); and
`extension/**` is not in the root `eslint.config.mjs` ignore list the way
`cli/**` is, so a root `npm run lint` also walks this source with the app's
ruleset. Align the two TypeScript versions when the root's peer range allows
it.

### Tests

```bash
cd extension
npm run test               # vitest run, over extension/tests/
```

This package deliberately carries **no vitest dependency of its own**: a
second vitest + vite tree in `extension/node_modules` would double what the CI
extension job installs. The script resolves the vitest binary from the repo
root's `node_modules` instead (npm puts every ancestor `node_modules/.bin` on
PATH for a run-script), so run `npm install` at the repo root once and
`npm run test` works from here. `extension/tests/` sits outside
`tsconfig.json`'s `include`, so nothing in it is part of `npm run typecheck`.

`extension/tests/pure-logic.test.ts` covers the notification threshold rule,
the format helpers, the category catalog and the plan labels. A second suite
lives in the **root** repo at `tests/extension/pure-modules.test.ts`, where it
can compare the extension against the app it mirrors: URL patterns,
scan-target classification asserted against `lib/scanner/scan-target-classify.ts`
so the two copies cannot drift, scan-lifecycle deadlines, and the severity
token ramp against `app/globals.css`.

Only modules that import nothing from `webextension-polyfill` can be tested in
either place: that package has no Node-side stub, so anything reaching
`browser.*` needs a real extension host.

### TypeScript version

The extension pins TypeScript 5.x while the repo root is on 6.x. The root's
`.github/dependabot.yml` holds TypeScript majors back because
`@typescript-eslint`'s peer range caps below 6.1, and the same constraint
applies here since root eslint also parses `extension/src`. An editor opened
at the repo root therefore resolves the root's TypeScript for these files
while CI type-checks them with this package's own. Keep new syntax inside
what 5.x accepts until both manifests move together.

## License

GPL-3.0, same as the main VulnRadar project. `LICENSE` and `THIRD-PARTY.md`
sit in this directory and are copied into `dist-chrome/` and `dist-firefox/`
by `scripts/build.mjs`, so both store packages carry the license text and the
notices for the MPL-2.0 (`webextension-polyfill`) and BSD-3-Clause
(`lit-html`) code inlined into the shipped bundles.
