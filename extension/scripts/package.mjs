#!/usr/bin/env node
// Zip the dist-{chrome,firefox}/ folders for store upload.
// Creates: vulnradar-chrome-v<version>.zip
//           vulnradar-firefox-v<version>.zip

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version;

// Every past build leaves its own vulnradar-{target}-v<version>.zip behind
// (Compress-Archive -Force only overwrites a zip for the SAME version), so
// these silently pile up in the extension root across releases. Delete any
// zip for a version other than the one we're about to build, for both
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

for (const target of ["chrome", "firefox"]) {
  const dist = resolve(ROOT, `dist-${target}`);
  if (!existsSync(dist)) {
    console.error(
      `[package] missing ${dist} - run \`npm run build:${target}\` first`,
    );
    process.exit(1);
  }
  const zip = resolve(ROOT, `vulnradar-${target}-v${VERSION}.zip`);
  console.log(`[package] ${target} -> ${zip.split(/[\\/]/).pop()}`);
  // execFileSync (not execSync) so the paths are handed to the powershell
  // process directly instead of being re-parsed by an outer shell. The
  // single-quote escaping below still protects the inner PowerShell string
  // itself in case ROOT (derived from __dirname) ever contains a `'`.
  const psDist = dist.replace(/'/g, "''");
  const psZip = zip.replace(/'/g, "''");
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${psDist}\\*' -DestinationPath '${psZip}' -Force`,
    ],
    { stdio: "inherit" },
  );
}
