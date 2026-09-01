#!/usr/bin/env node
// Zip the dist-{chrome,firefox}/ folders for store upload.
// Creates: vulnradar-chrome-v<version>.zip
//           vulnradar-firefox-v<version>.zip

import {
  createWriteStream,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version;

// Every past build leaves its own vulnradar-{target}-v<version>.zip behind,
// so these silently pile up in the extension root across releases. Delete
// any zip for a version other than the one we're about to build, for both
// targets, before packaging -- keeps exactly one zip per target on disk,
// always the current version.
const zipRe = /^vulnradar-(chrome|firefox)-v(.+)\.zip$/;
for (const name of readdirSync(ROOT)) {
  const m = name.match(zipRe);
  if (m && m[2] !== VERSION) {
    unlinkSync(resolve(ROOT, name));
    console.log(`[package] removed stale ${name}`);
  }
}

/**
 * Zips `dist` into `zip` using archiver instead of PowerShell's
 * Compress-Archive. Compress-Archive on Windows stores nested entries with
 * backslash path separators (e.g. "assets\options.css") instead of the
 * forward slashes the ZIP spec requires -- Chrome Web Store tolerated it,
 * but Firefox's AMO validator rejects the whole package with "Invalid file
 * name in archive". archiver always normalizes to forward slashes
 * regardless of host OS, matching what the CI release pipeline's `zip -r`
 * on Linux already produced correctly.
 */
function zipDirectory(dist, zip) {
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(zip);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolvePromise);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(dist, false);
    archive.finalize();
  });
}

/**
 * Walks `dir` and returns every .map file below it, relative to `dir`.
 * Sourcemaps are already off for release builds (vite.config.ts gates them on
 * mode, scripts/build.mjs sets sourcemap: false), but that used to be `true`
 * in both places and nothing noticed 606 KB of maps riding along in a 192 KB
 * extension. This is the gate that would have: a zip is never built from a
 * dist that still contains them.
 */
function findSourcemaps(dir, prefix = "") {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...findSourcemaps(full, `${prefix}${name}/`));
    } else if (name.endsWith(".map")) {
      found.push(`${prefix}${name}`);
    }
  }
  return found;
}

for (const target of ["chrome", "firefox"]) {
  const dist = resolve(ROOT, `dist-${target}`);
  if (!existsSync(dist)) {
    console.error(
      `[package] missing ${dist} - run \`npm run build:${target}\` first`,
    );
    process.exit(1);
  }
  const maps = findSourcemaps(dist);
  if (maps.length > 0) {
    console.error(
      `[package] dist-${target} contains ${maps.length} sourcemap(s): ${maps.join(", ")}`,
    );
    console.error(
      "[package] release builds must not ship sourcemaps - rebuild with `npm run build:" +
        target +
        "`",
    );
    process.exit(1);
  }
  const zip = resolve(ROOT, `vulnradar-${target}-v${VERSION}.zip`);
  console.log(`[package] ${target} -> ${zip.split(/[\\/]/).pop()}`);
  await zipDirectory(dist, zip);
}
