#!/usr/bin/env node
// Zip the dist-{chrome,firefox}/ folders for store upload.
// Creates: vulnradar-chrome-v<version>.zip
//           vulnradar-firefox-v<version>.zip

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version;

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
