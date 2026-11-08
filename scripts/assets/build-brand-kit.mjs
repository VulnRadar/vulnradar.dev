#!/usr/bin/env node
// Draws every logo file the project ships from two committed sources:
//
//   public/favicon.svg                         the mark (the master)
//   public/brand/source/vulnradar-wordmark.svg "VulnRadar", outlined
//
// and writes:
//
//   public/favicon.ico, icon-192.png, icon-512.png, apple-touch-icon.png
//   public/brand/logo/      the mark, 13 sizes
//   public/brand/lockup/    mark + wordmark, 14 banner slots x 2 variants
//   public/brand/profile/   avatars, transparent and opaque navy
//   public/brand/source/    the mark and the lockups as SVG
//   public/brand/README.md  the kit's start-here page
//   public/brand/vulnradar-brand-kit.zip
//   lib/brand/kit.generated.ts   byte sizes and a hash, for /brand
//
//   node scripts/assets/build-brand-kit.mjs
//
// Run by hand, like build-og-image.mjs: these are brand assets that change
// when the logo does, not on every build. It needs Node 22.18 or later (it
// imports lib/brand/kit.ts directly, through Node's type stripping, so the
// sizes, the clear space and the colours have one definition) and sharp.
// Node prints a MODULE_TYPELESS_PACKAGE_JSON warning for that import; it is
// harmless.
//
// The wordmark is never set from a font here. It was outlined once, from
// JetBrains Mono SemiBold, and the outlines are the committed master, so this
// script reruns anywhere without the font installed and the artwork cannot
// change with whichever version of the font a machine happens to have.
//
// No background, anywhere. Every icon is the round mark on a transparent
// square, exactly as favicon.svg draws it. That was a decision, not an
// oversight: the previous version of this script (build-icons.mjs) filled the
// square with the disc's navy, and the owner wants the mark as drawn. Two
// consequences are accepted with it. iOS paints the transparent corners of a
// home-screen icon black, and Android puts an icon that is not maskable on a
// plate of its own. That frame is the platform's, not part of the logo. For
// the same reason there is no maskable icon: a maskable icon is a full-bleed
// tile by definition, which is the background that was removed.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import * as kit from "../../lib/brand/kit.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pub = (...parts) => join(root, "public", ...parts);
const brand = (path) => pub("brand", ...path.split("/"));

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error(
    "[build-brand-kit] sharp is not installed. It is not a declared dependency of this repo (it currently resolves as an optional transitive of next). Install it just for this run with `npm i --no-save sharp`, then re-run this script.",
  );
  process.exit(1);
}

function fail(message) {
  console.error(`[build-brand-kit] ${message}`);
  process.exit(1);
}

const num = (value) => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

// ─── Sources ───────────────────────────────────────────────────────────────

const markSource = readFileSync(pub("favicon.svg"), "utf8");
if (markSource.match(/viewBox="([^"]+)"/)?.[1] !== "0 0 24 24") {
  fail(
    'public/favicon.svg no longer has viewBox "0 0 24 24". lib/brand/kit.ts measures the mark on that grid, so update MARK_GRID and MARK_DISC_DIAMETER with it.',
  );
}
if (!/<circle cx="12" cy="12" r="11" fill="#0f172a"\s*\/>/.test(markSource)) {
  fail(
    "public/favicon.svg has no navy disc of radius 11 at the centre. The clear space and every lockup are measured from that disc.",
  );
}
const markInner = markSource
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(/\n\s*\n/g, "\n")
  .trim();

const wordmarkSource = readFileSync(brand(kit.SOURCE_FILES.wordmark), "utf8");
const wordmarkViewBox = wordmarkSource.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
if (
  !wordmarkViewBox ||
  Number(wordmarkViewBox[1]) !== kit.WORDMARK_VIEWBOX.width ||
  Number(wordmarkViewBox[2]) !== kit.WORDMARK_VIEWBOX.height
) {
  fail(
    `${kit.SOURCE_FILES.wordmark} has viewBox ${wordmarkViewBox?.slice(1).join(" x ")}, but lib/brand/kit.ts says ${kit.WORDMARK_VIEWBOX.width} x ${kit.WORDMARK_VIEWBOX.height}. Update WORDMARK_VIEWBOX to match the artwork.`,
  );
}
const wordmarkPath = wordmarkSource.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
if (!wordmarkPath) fail(`${kit.SOURCE_FILES.wordmark} has no <path d>.`);

// ─── Drawing ───────────────────────────────────────────────────────────────

/** The mark with its disc's bounding box at (x, y), d across. */
function markAt(x, y, d) {
  const scale = d / kit.MARK_DISC_DIAMETER;
  const inset = (kit.MARK_GRID - kit.MARK_DISC_DIAMETER) / 2;
  return `<g transform="translate(${num(x)} ${num(y)}) scale(${Number(scale.toFixed(6))}) translate(-${inset} -${inset})">
${markInner}
</g>`;
}

function wordmarkAt(x, y, height, fill) {
  const scale = height / kit.WORDMARK_VIEWBOX.height;
  return `<path transform="translate(${num(x)} ${num(y)}) scale(${Number(scale.toFixed(6))})" fill="${fill}" d="${wordmarkPath}"/>`;
}

/** A lockup, its ink box at (x, y), with the disc d across. */
function lockupAt(layout, variant, x, y, d) {
  const box = kit.lockupBox(layout);
  return [
    markAt(x + box.mark.x * d, y + box.mark.y * d, d),
    wordmarkAt(
      x + box.wordmark.x * d,
      y + box.wordmark.y * d,
      box.wordmark.height * d,
      kit.WORDMARK_COLOURS[variant],
    ),
  ].join("\n");
}

const svg = (width, height, body, viewBox = `0 0 ${width} ${height}`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">
${body}
</svg>
`;

/** favicon.svg at N x N: the mark as drawn, one unit of margin round the disc. */
const markSvg = (size) => svg(size, size, markInner, "0 0 24 24");

/** The disc filling the square, for avatar slots that crop to a circle. */
const profileSvg = (size) => svg(size, size, markInner, "1 1 22 22");

/**
 * The opaque avatar: navy square, the radar drawn at 80% so a circular crop
 * leaves the arcs a margin. The disc is the same navy as the square, so it
 * disappears into it and only the radar reads.
 */
const PROFILE_NAVY_SCALE = 0.8;
const profileNavySvg = (size) =>
  svg(
    size,
    size,
    `<rect width="24" height="24" fill="${kit.PROFILE_NAVY}"/>
<g transform="translate(12 12) scale(${PROFILE_NAVY_SCALE}) translate(-12 -12)">
${markInner}
</g>`,
    "0 0 24 24",
  );

function bannerSvg(variant, width, height) {
  const fit = kit.fitLockup(width, height);
  return svg(width, height, lockupAt(fit.layout, variant, fit.x, fit.y, fit.d));
}

/** A source lockup, tight to its ink, with the disc 100 units across. */
function sourceLockupSvg(layout, variant) {
  const box = kit.lockupBox(layout);
  const d = 100;
  return svg(
    num(box.width * d),
    num(box.height * d),
    lockupAt(layout, variant, 0, 0, d),
  );
}

// ─── Raster and verify ─────────────────────────────────────────────────────

/**
 * Kit files are palette-quantised: the artwork is five flat colours and their
 * edges, so 256 entries hold it, and comparing both encodings at 6x zoom
 * showed no difference at any edge while the kit came out at 40% of the
 * size. The site icons stay full RGBA, because Windows only promises to read
 * 32-bit PNG entries inside an ICO and they are small anyway.
 */
async function rasterize(source, palette) {
  return sharp(Buffer.from(source))
    .png(
      palette
        ? { palette: true, quality: 100, effort: 10, compressionLevel: 9 }
        : { compressionLevel: 9, adaptiveFiltering: true },
    )
    .toBuffer();
}

/**
 * Reads a PNG back and checks it is what its name says: the dimensions, the
 * transparency (all four corners), and that something was drawn.
 */
async function verifyPng(label, bytes, width, height, background) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) {
    fail(
      `${label} is ${info.width}x${info.height}, expected ${width}x${height}.`,
    );
  }
  const alphaAt = (x, y) => data[(y * width + x) * 4 + 3];
  const corners = [
    alphaAt(0, 0),
    alphaAt(width - 1, 0),
    alphaAt(0, height - 1),
    alphaAt(width - 1, height - 1),
  ];
  const expected = background === "navy" ? 255 : 0;
  if (corners.some((a) => a !== expected)) {
    fail(
      `${label} has corner alpha ${corners.join(", ")}, expected ${expected} (${background}).`,
    );
  }
  // "Something was drawn": a transparent file needs visible pixels, an opaque
  // one needs pixels that are not the navy fill.
  const [nr, ng, nb] = [1, 3, 5].map((i) =>
    Number.parseInt(kit.PROFILE_NAVY.slice(i, i + 2), 16),
  );
  let drawn = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (background === "navy") {
      if (data[i] !== nr || data[i + 1] !== ng || data[i + 2] !== nb) drawn++;
    } else if (data[i + 3] > 0) {
      drawn++;
    }
  }
  if (drawn < width * height * 0.01) {
    fail(`${label} is empty: ${drawn} drawn pixels.`);
  }
}

async function png(
  label,
  source,
  width,
  height,
  background = "transparent",
  palette = true,
) {
  const bytes = await rasterize(source, palette);
  await verifyPng(label, bytes, width, height, background);
  return bytes;
}

const siteIcon = (label, size) =>
  png(label, markSvg(size), size, size, "transparent", false);

// ─── Site icons ────────────────────────────────────────────────────────────

for (const { path, size } of kit.SITE_ICONS.png) {
  writeFileSync(pub(path), await siteIcon(path, size));
}

// An ICO is a directory of images, and every browser since IE9 accepts PNG
// entries in it, so each size is written as a PNG and the header points at it.
{
  const sizes = kit.SITE_ICONS.ico.sizes;
  const images = [];
  for (const size of sizes) {
    images.push(await siteIcon(`favicon.ico ${size}`, size));
  }
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
  writeFileSync(
    pub(kit.SITE_ICONS.ico.path),
    Buffer.concat([header, ...images]),
  );
}

// ─── The kit ───────────────────────────────────────────────────────────────

const files = kit.brandKitFiles();

// Generated folders are rebuilt from the manifest, so a size dropped from
// kit.ts does not leave its old file behind to be zipped or linked.
for (const dir of ["logo", "lockup", "profile"]) {
  if (existsSync(brand(dir))) rmSync(brand(dir), { recursive: true });
  mkdirSync(brand(dir), { recursive: true });
}
mkdirSync(brand("source"), { recursive: true });

// The minimum is stated for the horizontal lockup; a stacked one is held to
// the wordmark height that minimum gives.
const minWordmark =
  (kit.LOCKUP_MIN_WIDTH_PX / kit.lockupBox("horizontal").width) *
  kit.LOCKUP.horizontal.wordmarkHeight;
for (const [w, h] of kit.LOCKUP_SLOTS) {
  const fit = kit.fitLockup(w, h);
  if (fit.wordmarkHeight < minWordmark) {
    fail(
      `${w}x${h} draws the wordmark ${num(fit.wordmarkHeight)} px tall, under the ${num(minWordmark)} px the lockup minimum allows.`,
    );
  }
}

const config = readFileSync(
  join(root, "lib", "config", "config-values.ts"),
  "utf8",
);
const appUrl =
  config.match(/CONFIG_APP_URL\s*=\s*"([^"]+)"/)?.[1] ??
  "https://vulnradar.dev";

for (const file of files) {
  const out = brand(file.path);
  if (file.kind === "logo") {
    writeFileSync(
      out,
      await png(file.path, markSvg(file.width), file.width, file.height),
    );
  } else if (file.kind === "profile") {
    const source =
      file.background === "navy"
        ? profileNavySvg(file.width)
        : profileSvg(file.width);
    writeFileSync(
      out,
      await png(file.path, source, file.width, file.height, file.background),
    );
  } else if (file.kind === "lockup") {
    writeFileSync(
      out,
      await png(
        file.path,
        bannerSvg(file.variant, file.width, file.height),
        file.width,
        file.height,
      ),
    );
  } else if (file.path === kit.SOURCE_FILES.mark) {
    writeFileSync(out, markSource);
  } else if (file.path === kit.SOURCE_FILES.wordmark) {
    // The master. Read above, never written.
  } else if (file.kind === "source") {
    writeFileSync(out, sourceLockupSvg(file.layout, file.variant));
  } else if (file.kind === "readme") {
    writeFileSync(out, readme());
  }
}

function readme() {
  const logoSizes = kit.LOGO_SIZES.join(", ");
  const slots = kit.LOCKUP_SLOTS.map(([w, h]) => `${w}x${h}`);
  const stacked = kit.LOCKUP_SLOTS.filter(
    ([w, h]) => kit.fitLockup(w, h).layout === "stacked",
  ).map(([w, h]) => `${w}x${h}`);
  const palette = kit.LOGO_PALETTE.map(
    (c) => `| ${c.name} | \`${c.hex}\` | ${c.part} |`,
  ).join("\n");
  return `# VulnRadar brand kit

The logo, the lockup and the colours, as files you can drop straight in. Use
them when you write about VulnRadar, link to it, or show that something works
with it. The same kit, with live examples, is at ${appUrl}/brand.

## The short version

| | |
|---|---|
| **Logo** | A navy disc with a radar sweep. Use the mark on its own when space is tight. |
| **Clear space** | X on every side, where X is a quarter of the disc's diameter. |
| **Minimum size** | Mark ${kit.MARK_MIN_PX} px. Lockup ${kit.LOCKUP_MIN_WIDTH_PX} px wide. Below that, the mark alone. |
| **Never** | Recolour, stretch, rotate, add a shadow or an outline, or set the wordmark in a font. |
| **Wordmark** | ${kit.WORDMARK_FACE.family} SemiBold, outlined to paths. You do not need the font. |
| **Background** | None. Every file is transparent except the two \`-navy\` avatars. |

## What is in here

\`\`\`
logo/      the mark on its own, ${kit.LOGO_SIZES.length} sizes:
           ${logoSizes} px
lockup/    mark and wordmark, ${kit.LOCKUP_SLOTS.length} slots, each in two variants:
           ${slots.slice(0, 7).join(", ")},
           ${slots.slice(7).join(", ")}
profile/   avatars: the disc filling the square, transparent corners,
           plus two opaque navy ones
source/    SVG: the mark, the wordmark, and the lockups
\`\`\`

File names follow one pattern, so you never have to guess:

\`\`\`
vulnradar-logo-512x512.png
vulnradar-lockup-on-dark-1500x500.png
vulnradar-profile-1024x1024-navy.png
\`\`\`

## Which one do I want?

- **A favicon, an app icon, a small square:** \`logo/\`. Use the size at or
  above the one you need.
- **An avatar:** \`profile/\`. Use a \`-navy\` file only where the slot
  flattens transparency: a JPEG, a video call, an App Store icon.
- **A header, a banner, a social card:** \`lockup/\`. \`on-dark\` has a light
  wordmark for dark backgrounds, \`on-light\` a navy one for light
  backgrounds. ${stacked.join(" and ")} are stacked, mark above wordmark; the
  rest are horizontal.
- **Print, or a size we do not ship:** \`source/*.svg\`.

Every lockup PNG is the exact slot size with the lockup centred and at least
the clear space around it, so it can be dropped in without cropping.

## Colours in the logo

| Part | Hex | Where |
|---|---|---|
${palette}

The wordmark is \`${kit.WORDMARK_COLOURS["on-dark"]}\` on dark backgrounds and \`${kit.WORDMARK_COLOURS["on-light"]}\` on light ones.
The mark never changes colour.

## The wordmark

"VulnRadar" is set in ${kit.WORDMARK_FACE.family} SemiBold (${kit.WORDMARK_FACE.license},
${kit.WORDMARK_FACE.source}), tracked ${kit.WORDMARK_FACE.tracking}, and
outlined to paths. The artwork looks the same everywhere and nobody needs the
font installed to use it. Do not retype it in another font, even a close one.

## Missing something?

A size or a format that is not here: ${appUrl}/contact.
`;
}

// ─── The ZIP ───────────────────────────────────────────────────────────────
//
// Written by hand rather than with an archiver package: a ZIP is a run of
// local headers, a central directory and an end record, and node:zlib has
// both deflate and CRC-32. Every entry carries the same fixed timestamp
// (1980-01-01 00:00, the format's epoch) and the entries are sorted, so
// rerunning with nothing changed writes identical bytes and a clean diff.

function zip(entries) {
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    // PNGs are already compressed; store them when deflate does not help.
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBytes, end]);
}

const contents = files.map((file) => ({
  path: file.path,
  data: readFileSync(brand(file.path)),
}));
const archive = zip(
  contents.map(({ path, data }) => ({
    name: `${kit.BRAND_KIT_ZIP_ROOT}/${path}`,
    data,
  })),
);
writeFileSync(brand(kit.BRAND_KIT_ZIP), archive);

// Nothing else belongs in public/brand/: a stray file there would be served
// but neither zipped nor listed on the page.
const expected = new Set([...files.map((f) => f.path), kit.BRAND_KIT_ZIP]);
function walk(dir, prefix = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(join(dir, entry.name), rel);
    else if (!expected.has(rel))
      fail(`public/brand/${rel} is not in the kit manifest.`);
  }
}
walk(pub("brand"));

// ─── kit.generated.ts ──────────────────────────────────────────────────────

const hash = createHash("sha256").update(archive).digest("hex").slice(0, 8);
const sizes = contents
  .map(({ path, data }) => `  "${path}": ${data.length},`)
  .join("\n");

writeFileSync(
  join(root, "lib", "brand", "kit.generated.ts"),
  `// Generated by scripts/assets/build-brand-kit.mjs. Do not edit by hand.
//
// The byte size of every file in public/brand/ and of the ZIP, so /brand
// prints real sizes, and a hash of the ZIP. The page appends the hash to every
// download URL: Cloudflare caches PNGs and ZIPs at the edge by path, and a
// redrawn logo would otherwise keep being served from the old bytes.
export const BRAND_KIT_HASH = "${hash}";

export const BRAND_KIT_ZIP_BYTES = ${archive.length};

export const BRAND_KIT_FILE_BYTES: Readonly<Record<string, number>> = {
${sizes}
};
`,
);

console.log(
  `[build-brand-kit] wrote ${files.length} kit files, the ZIP (${archive.length} bytes, hash ${hash}) and the site icons`,
);
