import { deflateSync } from "node:zlib";

/**
 * Structurally real image bytes for the avatar validator, which walks PNG
 * chunks and JPEG segments. A magic number followed by filler is exactly what
 * it exists to refuse, so a fixture has to be a whole image.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

export const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngIhdr(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA, what a canvas exports
  return chunk("IHDR", ihdr);
}

/** A complete, decodable RGBA PNG. */
export function realPng(width: number, height: number): Buffer {
  const row = Buffer.alloc(1 + width * 4, 0x7f);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngIhdr(width, height),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Declares any dimensions without paying for the pixels. */
export function pngDeclaring(width: number, height: number): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    pngIhdr(width, height),
    chunk("IDAT", deflateSync(Buffer.alloc(16))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function segment(marker: number, body: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

/** SOI, an APP0, a frame header, one scan with a stuffed 0xFF and an RST, EOI. */
export function jpegDeclaring(
  width: number,
  height: number,
  frameMarker = 0xc0,
): Buffer {
  const frame = Buffer.alloc(9);
  frame[0] = 8; // precision
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 1; // one component
  frame[6] = 1;
  frame[7] = 0x11;
  frame[8] = 0;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0, 1, 1])),
    segment(frameMarker, frame),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

export function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
