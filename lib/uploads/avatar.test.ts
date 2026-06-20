import { describe, it, expect } from "vitest";
import { validateAvatarDataUrl } from "@/lib/uploads/avatar";

/**
 * Phase 8C Commit 2 (H-1): tests for avatar upload validation.
 *
 * Verifies the MIME allowlist (png/jpeg only, SVG rejected),
 * magic-bytes enforcement, and size cap.
 */

// 1x1 transparent PNG
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// 1x1 white JPEG
const JPEG_1X1_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z";

// Real SVG with inline script — must be rejected
const SVG_WITH_SCRIPT_BASE64 = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>',
).toString("base64");

function dataUrl(mime: string, b64: string) {
  return `data:${mime};base64,${b64}`;
}

describe("validateAvatarDataUrl", () => {
  it("accepts a valid PNG", () => {
    const result = validateAvatarDataUrl(dataUrl("image/png", PNG_1X1_BASE64));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.mime).toBe("image/png");
      expect(result.bytes.length).toBeGreaterThan(0);
    }
  });

  it("accepts a valid JPEG", () => {
    const result = validateAvatarDataUrl(
      dataUrl("image/jpeg", JPEG_1X1_BASE64),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.mime).toBe("image/jpeg");
    }
  });

  it("rejects SVG entirely (XSS vector)", () => {
    const result = validateAvatarDataUrl(
      dataUrl("image/svg+xml", SVG_WITH_SCRIPT_BASE64),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/PNG or JPEG/);
    }
  });

  it("rejects image/gif (not in allowlist)", () => {
    // The smallest valid GIF is "GIF89a..." but the regex will
    // refuse to match before magic bytes are checked.
    const result = validateAvatarDataUrl(
      dataUrl(
        "image/gif",
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      ),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects empty string", () => {
    const result = validateAvatarDataUrl("");
    expect(result.valid).toBe(false);
  });

  it("rejects non-data URL (https)", () => {
    const result = validateAvatarDataUrl("https://example.com/avatar.png");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // The Discord CDN check returns this specific reason; non-CDN
      // URLs fall through to the data-URL check.
      expect(result.reason).toBeTruthy();
    }
  });

  it("rejects Discord CDN URL (deferred to the route for now)", () => {
    const result = validateAvatarDataUrl(
      "https://cdn.discordapp.com/avatars/1/abc.png",
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/External URL/);
    }
  });

  it("rejects data URL with mismatched magic bytes (claimed PNG, body is text)", () => {
    const textAsBase64 = Buffer.from("hello world").toString("base64");
    const result = validateAvatarDataUrl(dataUrl("image/png", textAsBase64));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/signature/);
    }
  });

  it("rejects data URL with claimed PNG magic but JPEG body", () => {
    // The JPEG base64 also starts with FF D8 FF in raw bytes, but
    // the prefix we look for is the PNG signature (89 50 4E 47 ...).
    // The JPEG bytes should fail the PNG magic check.
    const result = validateAvatarDataUrl(dataUrl("image/png", JPEG_1X1_BASE64));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/signature/);
    }
  });

  it("rejects oversized data URL", () => {
    // 6 MiB of zeros — bigger than the 5 MiB cap.
    const huge = Buffer.alloc(6 * 1024 * 1024, 0).toString("base64");
    const result = validateAvatarDataUrl(dataUrl("image/png", huge));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/too large/);
    }
  });

  it("rejects empty base64 payload (regex catches it at parse)", () => {
    // The regex `^data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)$`
    // requires at least one base64 char, so the empty payload is
    // rejected at the format check, not the empty-bytes check.
    const result = validateAvatarDataUrl(dataUrl("image/png", ""));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/PNG or JPEG/);
    }
  });
});
