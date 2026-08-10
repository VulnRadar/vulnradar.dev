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
export default defineConfig({
  root,
  publicDir: resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/lib"),
    },
  },
  // Explicit empty PostCSS config so Vite stops here instead of walking up
  // to the repo root's postcss.config.mjs/tailwind.config.ts (the main
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
    sourcemap: true,
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
});
