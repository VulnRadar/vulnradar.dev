#!/usr/bin/env node
// Zip the dist-{chrome,firefox}/ folders for store upload.
// Creates: vulnradar-chrome-v<version>.zip
//           vulnradar-firefox-v<version>.zip

import { execSync } from "node:child_process";
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
    console.error(`[package] missing ${dist} - run \`npm run build:${target}\` first`);
    process.exit(1);
  }
  const zip = resolve(ROOT, `vulnradar-${target}-v${VERSION}.zip`);
  console.log(`[package] ${target} -> ${zip.split(/[\\/]/).pop()}`);
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${dist}\\*' -DestinationPath '${zip}' -Force"`, { stdio: "inherit" });
}
