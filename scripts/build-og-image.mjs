#!/usr/bin/env node
// Rasterizes public/og-image.svg -> public/og-image.png (1200x630), the social
// card referenced by CONFIG_SEO_OG_IMAGE. Run this after editing the SVG:
//
//   node scripts/build-og-image.mjs
//
// It is intentionally NOT a build hook: the card is a static brand asset that
// rarely changes, unlike the check-count constants (which compile-checks-
// knowledge.mjs regenerates on every build).

import sharp from "sharp";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public", "og-image.svg"), "utf8");

await sharp(Buffer.from(svg))
  .resize(1200, 630)
  .png()
  .toFile(join(root, "public", "og-image.png"));

console.log("[build-og-image] wrote public/og-image.png (1200x630)");
