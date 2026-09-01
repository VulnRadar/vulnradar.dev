import { defineConfig } from "vite";
import { resolve } from "node:path";

const root = resolve(__dirname, "src");

// This config builds the extension *pages* only (popup, options, welcome) -
// each loaded by the browser as a real HTML document via
// `<script type="module">`, so ESM output with shared chunks is safe.
//
// background.js and content.js are deliberately NOT built here. Both are
// injected by the manifest ("background.scripts" / "content_scripts.js")
// and MUST be self-contained classic scripts - browsers load them without
// any module context, so a top-level `import` from a shared chunk (which
// Rollup produces whenever 2+ entries share a dependency, e.g. lib/types,
// lib/constants) is a SyntaxError at load time, silently killing the whole
// script. Chrome's manifest can opt background.js into `"type": "module"`
// to route around this, but Firefox's manifest cannot - it needs a plain
// classic script - so relying on ESM there breaks every message handler,
// which is why the reputation popup (and everything else) never showed up
// in Firefox. scripts/build.mjs builds background.js and content.js
// separately, each as its own single-entry `format: "iife"` bundle with no
// external imports, so they work unmodified as classic scripts everywhere.
// Every network call, deep link and privacy statement in the extension comes
// off VULNRADAR.apiHost, which used to be a plain literal with no override:
// a self-hoster could not point the extension at their own instance at all.
// It is a build-time define now, and scripts/build.mjs templates the same
// value into host_permissions so the browser actually allows the requests.
export const API_HOST_DEFINE = {
  __API_HOST__: JSON.stringify(
    process.env.VULNRADAR_API_HOST || "https://vulnradar.dev",
  ),
};

// `mode` is "development" only for `npm run dev` (the watch build); every
// release path (scripts/build.mjs, and therefore CI and the store zips) runs
// in the default production mode. Sourcemaps are gated on it: shipping them
// added ~606 KB of .map files to a 192 KB extension, roughly tripling what a
// user downloads and installs, and handing anyone who unpacks the zip the
// unminified source. Local development still gets full maps.
export default defineConfig(({ mode }) => ({
  root,
  // Only the extension's own runtime assets belong here: publicDir is copied
  // verbatim into every build, so anything added under it ends up inside the
  // store zip. The Chrome Web Store / AMO listing screenshots deliberately
  // live in ../store-assets instead, outside publicDir, since the extension
  // never references them.
  publicDir: resolve(__dirname, "public"),
  define: API_HOST_DEFINE,
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/lib"),
    },
  },
  // Explicit empty PostCSS config so Vite stops here instead of walking up
  // to the repo root's postcss.config.mjs/tailwind.config.mjs (the main
  // Next.js app's). This extension has no Tailwind classes anywhere -
  // popup.css/options.css and reputation-card.ts's CARD_CSS are all
  // hand-written CSS - so that root config was never doing real work here,
  // just emitting a "content option is missing" warning on every build
  // because none of its `content` globs match anything under extension/src.
  css: {
    postcss: {
      plugins: [],
    },
  },
  build: {
    outDir: resolve(__dirname, "dist-build"),
    emptyOutDir: true,
    minify: "esbuild",
    sourcemap: mode === "development",
    target: "es2022",
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup.html"),
        options: resolve(__dirname, "src/options.html"),
        welcome: resolve(__dirname, "src/welcome.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
        format: "esm",
        inlineDynamicImports: false,
      },
    },
  },
}));
