#!/usr/bin/env node
// Generate 16/32/48/128 PNG icons from the source SVG.
// Input: extension/public/favicon.svg (radar-style, from main project)
// Output: extension/public/icons/icon-{16,32,48,128}.png
// Also writes a 128x128 fallback to public/icons/icon-128-from-svg.png.

import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "public", "favicon.svg");
const OUT = resolve(ROOT, "public", "icons");
const SIZES = [16, 32, 48, 128];

if (!existsSync(SRC)) {
  console.error(`[icons] source not found: ${SRC}`);
  console.error(`[icons] copy public/favicon.svg from the main repo first.`);
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
const svg = await readFile(SRC);

for (const size of SIZES) {
  const file = join(OUT, `icon-${size}.png`);
  await sharp(svg, { density: 384 })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(file);
  console.log(`[icons] ${file}`);
}

console.log(`[icons] done. ${SIZES.length} icons in ${OUT}`);
