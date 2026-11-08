/**
 * The PNG reader the brand and icon tests rest on. If it misreads a filter,
 * every transparency assertion built on it is noise, so it is checked against
 * images whose every pixel is known: one per filter type, and a palette image
 * with a tRNS chunk, which is what the brand kit's PNGs are.
 */
import { describe, it, expect } from "vitest";
import { crc32, deflateSync } from "node:zlib";
import { cornerAlphas, coverage, decodePng, pngSize } from "./png";

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Encodes raw rows with one filter type, the way an encoder would. */
function encode(
  width: number,
  height: number,
  colourType: number,
  channels: number,
  pixels: number[],
  filter: number,
  extra: Buffer[] = [],
) {
  const stride = width * channels;
  const at = (x: number, y: number) =>
    x < 0 || y < 0 ? 0 : pixels[y * stride + x];
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(filter);
    for (let x = 0; x < stride; x++) {
      const value = at(x, y);
      const left = at(x - channels, y);
      const up = at(x, y - 1);
      const upLeft = at(x - channels, y - 1);
      const predicted = [
        0,
        left,
        up,
        (left + up) >> 1,
        paeth(left, up, upLeft),
      ][filter];
      rows.push((value - predicted + 256) & 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colourType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 3 x 3 RGBA with varied values so every predictor matters, transparent
// corners and an opaque centre.
const RGBA = [
  [10, 20, 30, 0],
  [200, 100, 50, 128],
  [255, 255, 255, 0],
  [1, 2, 3, 77],
  [90, 180, 45, 255],
  [250, 5, 125, 64],
  [0, 0, 0, 0],
  [33, 66, 99, 200],
  [128, 128, 128, 0],
].flat();

describe("decodePng", () => {
  it.each([0, 1, 2, 3, 4])("reads RGBA rows written with filter %i", (f) => {
    const png = decodePng(encode(3, 3, 6, 4, RGBA, f));
    expect([png.width, png.height]).toEqual([3, 3]);
    expect([...png.rgba]).toEqual(RGBA);
    expect(cornerAlphas(png)).toEqual([0, 0, 0, 0]);
    expect(coverage(png)).toBeCloseTo(5 / 9);
  });

  it("reads an RGB image as opaque", () => {
    const rgb = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const png = decodePng(encode(2, 2, 2, 3, rgb, 4));
    expect(cornerAlphas(png)).toEqual([255, 255, 255, 255]);
    expect([...png.rgba.subarray(4, 8)]).toEqual([4, 5, 6, 255]);
  });

  it("reads a palette image's alpha from tRNS, and treats a missing entry as opaque", () => {
    const plte = chunk(
      "PLTE",
      Buffer.from([0, 0, 0, 15, 23, 42, 96, 165, 250]),
    );
    const trns = chunk("tRNS", Buffer.from([0, 255]));
    const indices = [0, 1, 2, 0];
    const png = decodePng(encode(2, 2, 3, 1, indices, 1, [plte, trns]));
    expect([...png.rgba]).toEqual([
      0, 0, 0, 0, 15, 23, 42, 255, 96, 165, 250, 255, 0, 0, 0, 0,
    ]);
    expect(cornerAlphas(png)).toEqual([0, 255, 0, 255]);
  });

  it("refuses a format it does not handle rather than guessing", () => {
    const sixteenBit = encode(1, 1, 6, 4, [0, 0, 0, 0], 0);
    sixteenBit[24] = 16;
    expect(() => decodePng(sixteenBit)).toThrow(/unsupported/);
    expect(() => pngSize(Buffer.from("not a png at all"))).toThrow();
  });
});
