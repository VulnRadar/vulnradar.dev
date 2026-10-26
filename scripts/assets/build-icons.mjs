#!/usr/bin/env node
// Rasterizes the brand mark in public/favicon.svg into every icon a browser,
// a phone home screen, an installed app and a search result asks for:
//
//   public/icon.svg               solid tile, the tab icon in modern browsers
//   public/favicon.ico            16, 32 and 48 px in one file
//   public/icon-192.png           tile, manifest and rel=icon
//   public/icon-512.png           tile, manifest and the Organization logo
//   public/icon-maskable-512.png  tile with the mark inside the maskable safe zone
//   public/apple-touch-icon.png   180 px tile, iOS home screen
//
//   node scripts/assets/build-icons.mjs
//
// Not a build hook, for the same reason as build-og-image.mjs: these are
// static brand assets. Re-run it after editing public/favicon.svg.
//
// Why a tile and not the mark as drawn. favicon.svg is a dark disc on a
// transparent square, which is right for the in-app logo but wrong as an icon:
// iOS fills transparency on a home-screen icon with black, Android crops a
// maskable icon to its own shape, and on a dark tab strip the disc loses its
// edge. So the disc is dropped and its colour fills the whole square instead.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pub = (name) => join(root, "public", name);

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error(
    "[build-icons] sharp is not installed. It is not a declared dependency of this repo (it currently resolves as an optional transitive of next). Install it just for this run with `npm i --no-save sharp`, then re-run this script.",
  );
  process.exit(1);
}

const source = readFileSync(pub("favicon.svg"), "utf8");
const viewBox = source.match(/viewBox="([^"]+)"/)?.[1];
if (viewBox !== "0 0 24 24") {
  throw new Error(
    `public/favicon.svg has viewBox "${viewBox}". This script places the mark on a 24-unit tile, so update it if the source grid changes.`,
  );
}
const disc = /<circle cx="12" cy="12" r="11" fill="(#[0-9a-fA-F]{3,8})"\s*\/>/;
const tileColour = source.match(disc)?.[1];
if (!tileColour) {
  throw new Error(
    "public/favicon.svg has no full-size background disc to take the tile colour from.",
  );
}
const mark = source
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(disc, "")
  .trim();

// `scale` shrinks the mark about the centre. 0.9 leaves a margin so iOS's
// rounded corners never clip an arc. 0.78 keeps the mark's outer edge (about
// 11 of 12 units from the centre) inside the maskable safe zone, a circle of
// 40% of the icon's width.
function tile(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24">
  <rect width="24" height="24" fill="${tileColour}"/>
  <g transform="translate(12 12) scale(${scale}) translate(-12 -12)">
    ${mark}
  </g>
</svg>
`;
}

const standard = tile(0.9);
const maskable = tile(0.78);

const png = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

writeFileSync(pub("icon.svg"), standard);
writeFileSync(pub("icon-192.png"), await png(standard, 192));
writeFileSync(pub("icon-512.png"), await png(standard, 512));
writeFileSync(pub("icon-maskable-512.png"), await png(maskable, 512));
writeFileSync(pub("apple-touch-icon.png"), await png(standard, 180));

// An ICO is a directory of images, and every browser since IE9 accepts PNG
// entries in it, so each size is written as a PNG and the header points at it.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => png(standard, size)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
writeFileSync(pub("favicon.ico"), Buffer.concat([header, ...images]));

console.log(
  "[build-icons] wrote icon.svg, favicon.ico (16/32/48), icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png",
);
