#!/usr/bin/env node
// Build the VulnRadar browser extension for one or both targets.
// Usage:
//   node scripts/build.mjs            # build both chrome + firefox
//   node scripts/build.mjs chrome     # chrome only
//   node scripts/build.mjs firefox   # firefox only
//
// Reads package.json for the version, builds with Vite, copies
// manifest + icons into dist-{chrome,firefox}/.

import {
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
  readdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { build } from "vite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version;

// The instance this build talks to. A self-hoster sets VULNRADAR_API_HOST and
// gets a build whose constants, deep links and host_permissions all agree;
// unset, it is the hosted instance exactly as before.
const API_HOST = process.env.VULNRADAR_API_HOST || "https://vulnradar.dev";
const API_HOST_DEFINE = { __API_HOST__: JSON.stringify(API_HOST) };

const targetArg = process.argv[2];
const targets = (targetArg ? [targetArg] : ["chrome", "firefox"]).filter(
  (t) => t === "chrome" || t === "firefox",
);

if (targets.length === 0) {
  console.error("Unknown target. Use 'chrome' or 'firefox'.");
  process.exit(1);
}

console.log(`[build] version ${VERSION} - targets: ${targets.join(", ")}`);

// Regenerate src/tokens.css from src/lib/tokens.json first, so a checkout
// where someone edited the JSON and forgot cannot ship a stale stylesheet.
await import("./gen-tokens.mjs");

// Run vite build once (outputs to dist-build/) - this builds the extension
// *pages* (popup/options/welcome) per vite.config.ts.
const viteOut = resolve(ROOT, "dist-build");
await rm(viteOut, { recursive: true, force: true });
await build({
  root: resolve(ROOT, "src"),
  configFile: resolve(ROOT, "vite.config.ts"),
});

// background.js and content.js are injected directly by the manifest and
// must be self-contained classic scripts (no module system involved) - see
// the comment in vite.config.ts for why. Build each as its own single-entry
// IIFE bundle so Rollup inlines every shared dependency instead of splitting
// it into an external chunk that only an ES module could `import`.
const srcDir = resolve(ROOT, "src");
for (const [name, entry] of [
  ["background", resolve(srcDir, "background/service-worker.ts")],
  ["content", resolve(srcDir, "content/detector.ts")],
]) {
  await build({
    root: srcDir,
    configFile: false,
    define: API_HOST_DEFINE,
    resolve: {
      alias: {
        "@": resolve(srcDir, "lib"),
      },
    },
    build: {
      outDir: viteOut,
      emptyOutDir: false,
      minify: "esbuild",
      // No sourcemaps in a release build, matching vite.config.ts. This is
      // the release path (nothing calls build.mjs in development), and
      // background.js.map + content.js.map alone were 329 KB of the 606 KB
      // of maps that used to ship inside every store zip.
      sourcemap: false,
      target: "es2022",
      rollupOptions: {
        input: entry,
        output: {
          entryFileNames: `${name}.js`,
          format: "iife",
          inlineDynamicImports: true,
        },
      },
    },
  });
}

// Bundle each target
for (const target of targets) {
  const dist = resolve(ROOT, `dist-${target}`);
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await mkdir(resolve(dist, "icons"), { recursive: true });

  // Recursive copy of all build output (Vite emits a nested
  // structure: popup/popup.html, options/options.html, content.js,
  // background.js, chunks/*, etc.).
  await cp(viteOut, dist, { recursive: true });

  // Copy icons (generated)
  const iconsSrc = resolve(ROOT, "public", "icons");
  if (!existsSync(iconsSrc)) {
    console.warn(
      `[build] no icons found at ${iconsSrc} - run \`npm run icons\` first`,
    );
  } else {
    for (const f of await readdir(iconsSrc)) {
      await copyFile(join(iconsSrc, f), join(dist, "icons", f));
    }
  }

  // License + attribution. The store packages are the only copy of the
  // extension most people ever receive, and they carried neither the GPL text
  // nor a notice for the MPL-2.0 webextension-polyfill and BSD-3-Clause
  // lit-html that the IIFE build inlines verbatim into background.js and
  // content.js. MPL-2.0 section 3.2 requires the binary's recipients to be
  // told. Copied here so both dist dirs, and therefore both store zips, carry
  // them.
  for (const name of ["LICENSE", "THIRD-PARTY.md"]) {
    await copyFile(resolve(ROOT, name), join(dist, name));
  }

  // Inject manifest with resolved version
  const manifestTpl = JSON.parse(
    await readFile(resolve(ROOT, "manifest", `${target}.json`), "utf8"),
  );
  const finalManifest = JSON.parse(
    JSON.stringify(manifestTpl)
      .replace(/__VERSION__/g, VERSION)
      .replace(/__API_HOST__/g, API_HOST),
  );
  await writeFile(
    join(dist, "manifest.json"),
    JSON.stringify(finalManifest, null, 2) + "\n",
  );

  console.log(`[build] ${target} -> dist-${target}/`);
}

await rm(viteOut, { recursive: true, force: true });
