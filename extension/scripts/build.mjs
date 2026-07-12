#!/usr/bin/env node
// Build the VulnRadar browser extension for one or both targets.
// Usage:
//   node scripts/build.mjs            # build both chrome + firefox
//   node scripts/build.mjs chrome     # chrome only
//   node scripts/build.mjs firefox   # firefox only
//
// Reads package.json for the version, builds with Vite, copies
// manifest + icons into dist-{chrome,firefox}/.

import { copyFile, cp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { build } from "vite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version;

const targetArg = process.argv[2];
const targets = (
  targetArg ? [targetArg] : ["chrome", "firefox"]
).filter((t) => t === "chrome" || t === "firefox");

if (targets.length === 0) {
  console.error("Unknown target. Use 'chrome' or 'firefox'.");
  process.exit(1);
}

console.log(`[build] version ${VERSION} - targets: ${targets.join(", ")}`);

// Run vite build once (outputs to dist-build/)
const viteOut = resolve(ROOT, "dist-build");
await rm(viteOut, { recursive: true, force: true });
await build({
  root: resolve(ROOT, "src"),
  configFile: resolve(ROOT, "vite.config.ts"),
});

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

  // Inject manifest with resolved version
  const manifestTpl = JSON.parse(
    await readFile(
      resolve(ROOT, "manifest", `${target}.json`),
      "utf8",
    ),
  );
  const finalManifest = JSON.parse(
    JSON.stringify(manifestTpl).replace(/__VERSION__/g, VERSION),
  );
  await writeFile(
    join(dist, "manifest.json"),
    JSON.stringify(finalManifest, null, 2) + "\n",
  );

  console.log(`[build] ${target} -> dist-${target}/`);
}

await rm(viteOut, { recursive: true, force: true });

