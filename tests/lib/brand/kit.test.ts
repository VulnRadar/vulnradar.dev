/**
 * The brand kit as it actually is on disk, against lib/brand/kit.ts, which
 * the build script draws from and /brand prints from. If any of these drift
 * the page offers a file that does not exist, quotes a size that is wrong,
 * or shows a colour the logo does not use.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import {
  BRAND_KIT_ZIP,
  BRAND_KIT_ZIP_ROOT,
  CLEAR_SPACE,
  INTERFACE_FONTS,
  LOCKUP_MIN_WIDTH_PX,
  LOCKUP_SLOTS,
  LOGO_PALETTE,
  LOGO_SIZES,
  MARK_MIN_PX,
  PROFILE_NAVY,
  PROFILE_NAVY_SIZES,
  PROFILE_SIZES,
  SEVERITY_PALETTE,
  SOURCE_FILES,
  UI_PALETTE,
  WORDMARK_COLOURS,
  WORDMARK_VIEWBOX,
  brandKitFiles,
  contrastRatio,
  fitLockup,
  lockupBox,
} from "@/lib/brand/kit";
import {
  BRAND_KIT_FILE_BYTES,
  BRAND_KIT_HASH,
  BRAND_KIT_ZIP_BYTES,
} from "@/lib/brand/kit.generated";
import { cornerAlphas, coverage, decodePng } from "../../_helpers/png";

const ROOT = process.cwd();
const BRAND = join(ROOT, "public", "brand");
const read = (path: string) => readFileSync(join(BRAND, ...path.split("/")));
const files = brandKitFiles();

/** Every path under public/brand/, relative, with forward slashes. */
function onDisk(dir = BRAND, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(join(dir, name)).isDirectory()
      ? onDisk(join(dir, name), rel)
      : [rel];
  });
}

/** The entries of a ZIP, read from its central directory and inflated. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const compressed = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extra = bytes.readUInt16LE(at + 30);
    const comment = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    const start =
      local +
      30 +
      bytes.readUInt16LE(local + 26) +
      bytes.readUInt16LE(local + 28);
    const body = bytes.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect([method, data.length, crc32(data)], name).toEqual([
      method === 8 ? 8 : 0,
      size,
      crc,
    ]);
    entries.set(name, data);
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

describe("the manifest", () => {
  it("lists every size and slot the kit promises, once", () => {
    const paths = files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(files.filter((f) => f.kind === "logo")).toHaveLength(
      LOGO_SIZES.length,
    );
    expect(files.filter((f) => f.kind === "lockup")).toHaveLength(
      LOCKUP_SLOTS.length * 2,
    );
    expect(files.filter((f) => f.kind === "profile")).toHaveLength(
      PROFILE_SIZES.length + PROFILE_NAVY_SIZES.length,
    );
    expect(paths).toContain("README.md");
  });

  it("names each PNG by its size", () => {
    for (const file of files.filter((f) => f.width)) {
      expect(file.path, file.path).toContain(`-${file.width}x${file.height}`);
    }
  });

  it("matches public/brand/ exactly, plus the ZIP", () => {
    expect(onDisk().sort()).toEqual(
      [...files.map((f) => f.path), BRAND_KIT_ZIP].sort(),
    );
  });
});

describe("the PNGs", () => {
  it.each(files.filter((f) => f.path.endsWith(".png")).map((f) => [f.path, f]))(
    "%s has the named size, the right transparency and something drawn",
    (_, file) => {
      const png = decodePng(read(file.path));
      expect([png.width, png.height]).toEqual([file.width, file.height]);
      if (file.background === "navy") {
        expect(cornerAlphas(png)).toEqual([255, 255, 255, 255]);
        const [r, g, b] = [1, 3, 5].map((i) =>
          Number.parseInt(PROFILE_NAVY.slice(i, i + 2), 16),
        );
        expect([...png.rgba.subarray(0, 4)]).toEqual([r, g, b, 255]);
      } else {
        expect(cornerAlphas(png)).toEqual([0, 0, 0, 0]);
        expect(coverage(png)).toBeGreaterThan(0.01);
      }
    },
  );
});

describe("the sources", () => {
  it("ships favicon.svg, unchanged, as the mark's master", () => {
    expect(read(SOURCE_FILES.mark).toString("utf8")).toBe(
      readFileSync(join(ROOT, "public", "favicon.svg"), "utf8"),
    );
  });

  it("has an outlined wordmark whose box is the one kit.ts measures", () => {
    const svg = read(SOURCE_FILES.wordmark).toString("utf8");
    expect(svg).toContain(
      `viewBox="0 0 ${WORDMARK_VIEWBOX.width} ${WORDMARK_VIEWBOX.height}"`,
    );
    // Paths, not type: the artwork must not depend on a font being installed.
    expect(svg).not.toMatch(/<text|font-family/);
    expect(svg).toMatch(/<path[^>]* d="M/);
  });

  it("draws each lockup SVG with the real mark and the right wordmark colour", () => {
    const mark = readFileSync(join(ROOT, "public", "favicon.svg"), "utf8");
    const wordmarkPath = read(SOURCE_FILES.wordmark)
      .toString("utf8")
      .match(/ d="([^"]+)"/)![1];
    for (const layout of ["horizontal", "stacked"] as const) {
      for (const variant of ["on-dark", "on-light"] as const) {
        const svg = read(SOURCE_FILES.lockup[layout][variant]).toString("utf8");
        expect(svg).toContain(
          '<circle cx="12" cy="12" r="11" fill="#0f172a"/>',
        );
        expect(svg).toContain(mark.match(/<path d="M12 2a10[^"]+"/)![0]);
        expect(svg).toContain(
          `fill="${WORDMARK_COLOURS[variant]}" d="${wordmarkPath}"`,
        );
      }
    }
  });
});

describe("the ZIP", () => {
  const zip = read(BRAND_KIT_ZIP);
  const entries = unzip(zip);

  it("holds exactly the listed files, byte for byte, under one folder", () => {
    expect([...entries.keys()]).toEqual(
      files.map((f) => `${BRAND_KIT_ZIP_ROOT}/${f.path}`),
    );
    for (const file of files) {
      expect(
        entries
          .get(`${BRAND_KIT_ZIP_ROOT}/${file.path}`)!
          .equals(read(file.path)),
        file.path,
      ).toBe(true);
    }
  });

  it("carries one fixed timestamp, so a rebuild writes the same bytes", () => {
    const end = zip.length - 22;
    let at = zip.readUInt32LE(end + 16);
    const stamps = new Set<string>();
    for (let i = 0; i < entries.size; i++) {
      stamps.add(`${zip.readUInt16LE(at + 12)}/${zip.readUInt16LE(at + 14)}`);
      at += 46 + zip.readUInt16LE(at + 28);
    }
    expect([...stamps]).toEqual(["0/33"]);
  });
});

describe("kit.generated.ts", () => {
  it("has the real size of every file and of the ZIP", () => {
    expect(Object.keys(BRAND_KIT_FILE_BYTES).sort()).toEqual(
      files.map((f) => f.path).sort(),
    );
    for (const file of files) {
      expect(BRAND_KIT_FILE_BYTES[file.path], file.path).toBe(
        read(file.path).length,
      );
    }
    expect(BRAND_KIT_ZIP_BYTES).toBe(read(BRAND_KIT_ZIP).length);
  });

  it("hashes the ZIP on disk", () => {
    expect(BRAND_KIT_HASH).toBe(
      createHash("sha256")
        .update(read(BRAND_KIT_ZIP))
        .digest("hex")
        .slice(0, 8),
    );
  });
});

describe("the lockup geometry", () => {
  it("stacks the two slots a horizontal lockup would be too small in", () => {
    const stacked = LOCKUP_SLOTS.filter(
      ([w, h]) => fitLockup(w, h).layout === "stacked",
    );
    expect(stacked).toEqual([
      [300, 250],
      [300, 600],
    ]);
  });

  it.each(LOCKUP_SLOTS.map(([w, h]) => [`${w}x${h}`, w, h] as const))(
    "%s keeps the clear space on every side and stays above the minimum",
    (_, w, h) => {
      const fit = fitLockup(w, h);
      const x = CLEAR_SPACE * fit.d;
      expect(fit.x).toBeGreaterThanOrEqual(x - 1e-9);
      expect(fit.y).toBeGreaterThanOrEqual(x - 1e-9);
      expect(w - fit.x - fit.width).toBeGreaterThanOrEqual(x - 1e-9);
      expect(h - fit.y - fit.height).toBeGreaterThanOrEqual(x - 1e-9);
      const minWordmark =
        (LOCKUP_MIN_WIDTH_PX / lockupBox("horizontal").width) *
        lockupBox("horizontal").wordmark.height;
      expect(fit.wordmarkHeight).toBeGreaterThanOrEqual(minWordmark);
    },
  );

  it("keeps the mark inside the lockup minimum at least the mark minimum", () => {
    // The disc is 22 of the mark's 24 units, so a 16 px mark is a 14.67 px disc.
    const disc = LOCKUP_MIN_WIDTH_PX / lockupBox("horizontal").width;
    expect((disc * 24) / 22).toBeGreaterThanOrEqual(MARK_MIN_PX);
  });
});

describe("the palettes", () => {
  it("lists exactly the colours favicon.svg paints with", () => {
    const svg = readFileSync(join(ROOT, "public", "favicon.svg"), "utf8");
    const used = new Set(
      [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/gi)].map((m) =>
        m[1].toLowerCase(),
      ),
    );
    expect(new Set(LOGO_PALETTE.map((c) => c.hex))).toEqual(used);
  });

  /** The HSL triplet a token has in the given block of globals.css. */
  function token(css: string, name: string): string {
    const m = css.match(
      new RegExp(`--${name}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%;`),
    );
    expect(m, name).not.toBeNull();
    return `${m![1]} ${m![2]}% ${m![3]}%`;
  }

  function hex(hsl: string): string {
    const [h, s, l] = hsl.replace(/%/g, "").split(" ").map(Number);
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(v * 255)
        .toString(16)
        .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  it.each([...UI_PALETTE, ...SEVERITY_PALETTE].map((t) => [t.token, t]))(
    "--%s matches app/globals.css in both themes",
    (name, entry) => {
      const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
      const darkAt = css.indexOf(".dark {");
      const light = css.slice(css.indexOf(":root {"), darkAt);
      const dark = css.slice(darkAt, css.indexOf("\n  }", darkAt));
      expect(entry.light.hsl).toBe(token(light, name));
      expect(entry.dark.hsl).toBe(token(dark, name));
      expect(entry.light.hex).toBe(hex(entry.light.hsl));
      expect(entry.dark.hex).toBe(hex(entry.dark.hsl));
    },
  );

  it("names the interface stacks Tailwind really renders", () => {
    const theme = readFileSync(
      join(ROOT, "node_modules", "tailwindcss", "theme.css"),
      "utf8",
    );
    const stack = (name: string) =>
      theme
        .match(new RegExp(`--font-${name}:([^;]+);`))![1]
        .replace(/\s+/g, " ")
        .trim();
    expect(INTERFACE_FONTS.sans).toBe(stack("sans"));
    expect(INTERFACE_FONTS.mono).toBe(stack("mono"));
    // And nothing in the project replaces them.
    expect(readFileSync(join(ROOT, "tailwind.config.mjs"), "utf8")).not.toMatch(
      /fontFamily/,
    );
  });
});

describe("contrastRatio", () => {
  it("is the WCAG ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("gives each wordmark variant at least AA on the surfaces it is for", () => {
    expect(
      contrastRatio(WORDMARK_COLOURS["on-light"], "#ffffff"),
    ).toBeGreaterThan(4.5);
    const darkBackground = UI_PALETTE.find((t) => t.token === "background")!;
    expect(
      contrastRatio(WORDMARK_COLOURS["on-dark"], darkBackground.dark.hex),
    ).toBeGreaterThan(4.5);
  });
});
