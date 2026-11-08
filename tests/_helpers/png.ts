/**
 * A PNG reader small enough to trust, for the tests that prove what an image
 * on disk actually contains: its size, and the alpha of any pixel.
 *
 * sharp would do this, but it is not a declared dependency (it resolves only
 * as an optional transitive of next), and a test that silently cannot import
 * its decoder proves nothing. This handles exactly what the repo's PNGs are:
 * 8-bit RGB, RGBA or palette (with tRNS), not interlaced. Anything else
 * throws rather than guessing.
 */
import { inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  colourType: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  rgba: Uint8Array;
}

const CHANNELS: Record<number, number> = { 2: 3, 3: 1, 6: 4 };

/** Width and height from the IHDR chunk, without decoding the image. */
export function pngSize(bytes: Uint8Array): [number, number] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("not a PNG");
  }
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const [width, height] = pngSize(buf);
  const bitDepth = buf[24];
  const colourType = buf[25];
  const interlace = buf[28];
  const channels = CHANNELS[colourType];
  if (bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error(
      `unsupported PNG: bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace}`,
    );
  }

  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length;) {
    const length = buf.readUInt32BE(at);
    const type = buf.subarray(at + 4, at + 8).toString("ascii");
    const data = buf.subarray(at + 8, at + 8 + length);
    if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") idat.push(data);
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft =
        y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0)
        throw new Error(`bad filter ${filter} on row ${y}`);
      pixels[y * stride + x] = value & 255;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (colourType === 6) {
      rgba.set(pixels.subarray(i * 4, i * 4 + 4), i * 4);
    } else if (colourType === 2) {
      rgba.set(pixels.subarray(i * 3, i * 3 + 3), i * 4);
      rgba[i * 4 + 3] = 255;
    } else {
      const index = pixels[i];
      if (!palette) throw new Error("palette PNG with no PLTE");
      rgba.set(palette.subarray(index * 3, index * 3 + 3), i * 4);
      rgba[i * 4 + 3] =
        transparency && index < transparency.length ? transparency[index] : 255;
    }
  }
  return { width, height, colourType, rgba };
}

export function alphaAt(png: DecodedPng, x: number, y: number) {
  return png.rgba[(y * png.width + x) * 4 + 3];
}

/** Alpha of the four corner pixels, clockwise from the top left. */
export function cornerAlphas(png: DecodedPng): number[] {
  const { width: w, height: h } = png;
  return [
    alphaAt(png, 0, 0),
    alphaAt(png, w - 1, 0),
    alphaAt(png, w - 1, h - 1),
    alphaAt(png, 0, h - 1),
  ];
}

/** Share of pixels with any opacity at all, 0 to 1. */
export function coverage(png: DecodedPng): number {
  let drawn = 0;
  for (let i = 3; i < png.rgba.length; i += 4) if (png.rgba[i] > 0) drawn++;
  return drawn / (png.width * png.height);
}
