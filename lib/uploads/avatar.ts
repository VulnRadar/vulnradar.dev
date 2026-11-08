/**
 * Avatar upload validation.
 *
 * Enforces a strict allowlist of safe image formats and rejects anything
 * that could be interpreted as code (data: URLs, SVGs, etc).
 *
 * Validates an avatar `data:image/...;base64,...` URL from the
 * profile-update route. We intentionally avoid the `sharp` native
 * dependency (build complexity + memory cost) and instead enforce:
 *
 *  1. **MIME-type allowlist**: only `image/png` and `image/jpeg`.
 *     SVG is rejected outright — it can carry inline `<script>`
 *     and is the most common XSS vector for avatar uploads.
 *  2. **Magic-bytes check**: the first 8 bytes must match the
 *     declared MIME type (PNG `89 50 4E 47 0D 0A 1A 0A`,
 *     JPEG `FF D8 FF`).
 *  3. **Size cap**: what the crop dialog can produce (see MAX_AVATAR_BYTES).
 *  4. **Structure**: the PNG chunks or JPEG segments are walked end to end.
 *     The dimensions must be within 1024x1024 and nothing may follow the end
 *     of the image. A signature alone let the origin host any blob at all,
 *     labelled as an image.
 *
 * Returns `{ valid: true }` or `{ valid: false, reason }`.
 */

/**
 * The crop dialog (components/modals/image-crop-dialog.tsx) always exports a
 * 256x256 PNG, which is at most about 263 KB whatever the pixels are. 25% over
 * that leaves room for an encoder's chunking.
 *
 * It has to stay well under the 1 MiB request cap (lib/api/request-limits.ts),
 * which a base64 body reaches at about 780 KB of image. The old limit here was
 * 5 MiB, so the request cap always fired first and this message was never the
 * one anybody saw.
 */
const CROP_OUTPUT_SIDE = 256;
const MAX_AVATAR_BYTES = CROP_OUTPUT_SIDE * CROP_OUTPUT_SIDE * 4 * 1.25;

const MAX_AVATAR_DIMENSION = 1024;

/** What an upload was held to before the crop dialog existed. */
export const LEGACY_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const DATA_URL_RE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

const TRAILING_BYTES = "Avatar has extra data after the end of the image.";
const NOT_AN_IMAGE = "Avatar is not a complete image.";

export type AvatarValidation =
  | { valid: true; mime: "image/png" | "image/jpeg"; bytes: Buffer }
  | { valid: false; reason: string };

function dimensionProblem(width: number, height: number): string | null {
  if (width === 0 || height === 0) return NOT_AN_IMAGE;
  if (width > MAX_AVATAR_DIMENSION || height > MAX_AVATAR_DIMENSION) {
    return `Avatar is too big (max ${MAX_AVATAR_DIMENSION}x${MAX_AVATAR_DIMENSION} pixels).`;
  }
  return null;
}

/** Walks the chunk list: IHDR first, at least one IDAT, IEND last. */
function pngProblem(bytes: Buffer): string | null {
  let offset = PNG_MAGIC.length;
  let sawHeader = false;
  let sawData = false;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (next > bytes.length) return NOT_AN_IMAGE;

    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return NOT_AN_IMAGE;
      const problem = dimensionProblem(
        bytes.readUInt32BE(offset + 8),
        bytes.readUInt32BE(offset + 12),
      );
      if (problem) return problem;
      sawHeader = true;
    } else if (type === "IHDR") {
      // Only the first one had its dimensions checked, and which of two a
      // decoder honours is up to the decoder.
      return NOT_AN_IMAGE;
    } else if (type === "IDAT") {
      sawData = true;
    } else if (type === "IEND") {
      if (!sawData) return NOT_AN_IMAGE;
      return next === bytes.length ? null : TRAILING_BYTES;
    }
    offset = next;
  }
  return NOT_AN_IMAGE;
}

/** SOF0 to SOF15, which are the markers C0 to CF less DHT, JPG and DAC. */
function isJpegFrameHeader(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function isJpegRestart(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

/**
 * The index of the marker that ends the entropy-coded data starting at `from`,
 * or -1. Inside a scan an FF is either stuffed (FF 00), a restart interval
 * (FF D0 to D7), fill before a marker, or the marker itself.
 */
function endOfJpegScan(bytes: Buffer, from: number): number {
  let i = bytes.indexOf(0xff, from);
  while (i !== -1 && i + 1 < bytes.length) {
    const following = bytes[i + 1]!;
    if (following === 0xff) {
      i += 1;
    } else if (following === 0 || isJpegRestart(following)) {
      i = bytes.indexOf(0xff, i + 2);
    } else {
      return i;
    }
  }
  return -1;
}

/** Walks the segment list from SOI to EOI, across every scan. */
function jpegProblem(bytes: Buffer): string | null {
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return NOT_AN_IMAGE;
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return NOT_AN_IMAGE;
    const marker = bytes[offset]!;
    offset += 1;

    if (marker === 0xd9) {
      if (!sawFrame || !sawScan) return NOT_AN_IMAGE;
      return offset === bytes.length ? null : TRAILING_BYTES;
    }
    // A segment with no length of its own: TEM and the restart markers.
    if (marker === 0x01 || isJpegRestart(marker)) continue;

    if (offset + 2 > bytes.length) return NOT_AN_IMAGE;
    const length = bytes.readUInt16BE(offset);
    const next = offset + length;
    if (length < 2 || next > bytes.length) return NOT_AN_IMAGE;

    if (isJpegFrameHeader(marker)) {
      if (length < 8) return NOT_AN_IMAGE;
      const problem = dimensionProblem(
        bytes.readUInt16BE(offset + 5),
        bytes.readUInt16BE(offset + 3),
      );
      if (problem) return problem;
      sawFrame = true;
    }

    if (marker === 0xda) {
      sawScan = true;
      const end = endOfJpegScan(bytes, next);
      if (end === -1) return NOT_AN_IMAGE;
      offset = end;
    } else {
      offset = next;
    }
  }
  return NOT_AN_IMAGE;
}

export function validateAvatarDataUrl(
  input: string,
  /** For a value already stored by an older version, which was accepted under
   *  the rules of its day. The MIME and signature tests still apply; the size
   *  cap is the old one and the walk of the image structure is skipped, or the
   *  boot backfill could never convert it and it would stay a data: URL. */
  options: { legacy?: boolean } = {},
): AvatarValidation {
  const maxBytes = options.legacy ? LEGACY_AVATAR_MAX_BYTES : MAX_AVATAR_BYTES;

  // Allow clearing the avatar (empty string).
  if (input === "") {
    return { valid: false, reason: "Empty avatar" };
  }

  // Allow pre-cleared Discord CDN URLs (these come from OAuth, not upload).
  if (input.startsWith("https://cdn.discordapp.com/")) {
    return { valid: false, reason: "External URL not validated here" };
  }

  const match = DATA_URL_RE.exec(input);
  if (!match) {
    return {
      valid: false,
      reason:
        "Avatar must be a PNG or JPEG data URL (data:image/png;base64,... or data:image/jpeg;base64,...). SVG is not allowed.",
    };
  }

  const declaredMime = match[1] === "png" ? "image/png" : "image/jpeg";
  const b64 = match[2]!;

  // Decode and check the size cap before magic-bytes (cheap reject).
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) {
    return { valid: false, reason: "Avatar is empty after decoding." };
  }
  if (bytes.length > maxBytes) {
    return {
      valid: false,
      reason: `Avatar is too large (max ${maxBytes / 1024} KiB).`,
    };
  }

  // Magic-bytes check: declared MIME must match actual file signature.
  const expected = declaredMime === "image/png" ? PNG_MAGIC : JPEG_MAGIC;
  if (
    bytes.length < expected.length ||
    !bytes.subarray(0, expected.length).equals(expected)
  ) {
    return {
      valid: false,
      reason: `Avatar bytes do not match declared ${declaredMime} signature.`,
    };
  }

  if (!options.legacy) {
    const problem =
      declaredMime === "image/png" ? pngProblem(bytes) : jpegProblem(bytes);
    if (problem) return { valid: false, reason: problem };
  }

  return { valid: true, mime: declaredMime, bytes };
}
