/**
 * Avatar upload validation (Phase 8C Commit 2 — H-1).
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
 *  3. **Size cap**: 5 MiB after base64 decode.
 *
 * Returns `{ valid: true }` or `{ valid: false, reason }`.
 */

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MiB

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const DATA_URL_RE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

export type AvatarValidation =
  | { valid: true; mime: "image/png" | "image/jpeg"; bytes: Buffer }
  | { valid: false; reason: string };

export function validateAvatarDataUrl(input: string): AvatarValidation {
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
  if (bytes.length > MAX_AVATAR_BYTES) {
    return {
      valid: false,
      reason: `Avatar is too large (max ${MAX_AVATAR_BYTES / 1024 / 1024} MiB).`,
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

  return { valid: true, mime: declaredMime, bytes };
}
