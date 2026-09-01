# Third-party notices

The VulnRadar browser extension is licensed under the GNU General Public
License v3.0. The full text is in the `LICENSE` file shipped alongside this
one, both inside the packaged extension and in the source tree.

The build inlines the two runtime dependencies below verbatim into the shipped
bundles (`background.js`, `content.js`, `popup.js`, `options.js`,
`welcome.js`), so they are distributed as part of every install. They keep
their own licenses.

## webextension-polyfill 0.12.0

- License: Mozilla Public License 2.0 (MPL-2.0)
- Copyright: Mozilla Foundation and contributors
- Source: https://github.com/mozilla/webextension-polyfill
- License text: https://mozilla.org/MPL/2.0/

Per MPL-2.0 section 3.2, the source of the covered files is available at the
repository above, and at https://www.npmjs.com/package/webextension-polyfill
for this exact version. No modifications were made to it.

## lit-html 3.3.3

- License: BSD 3-Clause
- Copyright: Google LLC
- Source: https://github.com/lit/lit/tree/main/packages/lit-html
- License text: https://github.com/lit/lit/blob/main/packages/lit-html/LICENSE

No modifications were made to it.

## Everything else

Every other package in `extension/package.json` is a build-time or type-only
dependency (Vite, esbuild, TypeScript, Prettier, sharp, archiver, the
`@types/*` packages). None of them contribute code to the shipped extension,
so they are not distributed and are not listed here.

The extension's own source is at
https://github.com/VulnRadar/vulnradar.dev under `extension/`, and the AMO
submission includes a source archive built by
`extension/scripts/package-source.mjs`.
