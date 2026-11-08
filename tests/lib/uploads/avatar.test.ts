import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { validateAvatarDataUrl } from "@/lib/uploads/avatar";
import {
  PNG_SIGNATURE,
  dataUrl as imageDataUrl,
  jpegDeclaring,
  pngDeclaring,
  realPng,
} from "./_avatar-fixtures";

/**
tests for avatar upload validation.
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
    // 6 MiB of zeros: over the cap whatever it is set to.
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

  /**
   * The check used to stop at the first 3 to 8 bytes, so the origin would host
   * any blob that started with a signature, labelled image/png. Each case below
   * passed that check.
   */
  describe("the image structure behind the signature", () => {
    it("rejects a PNG signature followed by random bytes", () => {
      const result = validateAvatarDataUrl(
        imageDataUrl(
          "image/png",
          Buffer.concat([PNG_SIGNATURE, randomBytes(1000)]),
        ),
      );
      expect(result.valid).toBe(false);
    });

    it("rejects a JPEG signature followed by random bytes", () => {
      const result = validateAvatarDataUrl(
        imageDataUrl(
          "image/jpeg",
          Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(1000)]),
        ),
      );
      expect(result.valid).toBe(false);
    });

    it("rejects a 20000x20000 PNG header", () => {
      const result = validateAvatarDataUrl(
        imageDataUrl("image/png", pngDeclaring(20000, 20000)),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toMatch(/1024/);
    });

    it("rejects a second PNG header hiding bigger dimensions", () => {
      const headerEnd = 33; // signature + length + type + 13 bytes + CRC
      const small = pngDeclaring(16, 16);
      const huge = pngDeclaring(20000, 20000);
      const bytes = Buffer.concat([
        small.subarray(0, headerEnd),
        huge.subarray(PNG_SIGNATURE.length, headerEnd),
        small.subarray(headerEnd),
      ]);

      expect(
        validateAvatarDataUrl(imageDataUrl("image/png", bytes)).valid,
      ).toBe(false);
    });

    it("rejects a zero-width PNG header", () => {
      expect(
        validateAvatarDataUrl(imageDataUrl("image/png", pngDeclaring(0, 16)))
          .valid,
      ).toBe(false);
    });

    it("accepts a real 256x256 PNG, which is what the crop dialog exports", () => {
      const bytes = realPng(256, 256);
      const result = validateAvatarDataUrl(imageDataUrl("image/png", bytes));
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.bytes.equals(bytes)).toBe(true);
    });

    it("accepts exactly 1024x1024 and refuses one pixel more", () => {
      expect(
        validateAvatarDataUrl(
          imageDataUrl("image/png", pngDeclaring(1024, 1024)),
        ).valid,
      ).toBe(true);
      expect(
        validateAvatarDataUrl(
          imageDataUrl("image/png", pngDeclaring(1025, 1024)),
        ).valid,
      ).toBe(false);
    });

    it("rejects bytes after a PNG's IEND", () => {
      const result = validateAvatarDataUrl(
        imageDataUrl(
          "image/png",
          Buffer.concat([realPng(8, 8), Buffer.from("<script>")]),
        ),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toMatch(/after the end/);
    });

    it("rejects a PNG cut off before IEND", () => {
      const whole = realPng(8, 8);
      expect(
        validateAvatarDataUrl(
          imageDataUrl("image/png", whole.subarray(0, whole.length - 12)),
        ).valid,
      ).toBe(false);
    });

    it("rejects a PNG whose chunk length runs off the end of the file", () => {
      const lying = Buffer.from(realPng(8, 8));
      lying.writeUInt32BE(0x7fffffff, 8 + 25);
      expect(
        validateAvatarDataUrl(imageDataUrl("image/png", lying)).valid,
      ).toBe(false);
    });

    it("accepts a baseline and a progressive JPEG within the limit", () => {
      for (const marker of [0xc0, 0xc2]) {
        expect(
          validateAvatarDataUrl(
            imageDataUrl("image/jpeg", jpegDeclaring(256, 256, marker)),
          ).valid,
        ).toBe(true);
      }
    });

    it("rejects a JPEG frame over 1024x1024", () => {
      const result = validateAvatarDataUrl(
        imageDataUrl("image/jpeg", jpegDeclaring(20000, 300)),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toMatch(/1024/);
    });

    it("rejects bytes after a JPEG's EOI", () => {
      const result = validateAvatarDataUrl(
        imageDataUrl(
          "image/jpeg",
          Buffer.concat([jpegDeclaring(16, 16), randomBytes(32)]),
        ),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toMatch(/after the end/);
    });

    it("rejects a JPEG with no frame header", () => {
      expect(
        validateAvatarDataUrl(
          imageDataUrl("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
        ).valid,
      ).toBe(false);
    });
  });

  it("caps at what the crop dialog can produce, under the 1 MiB request cap", () => {
    // A 256x256 RGBA PNG is at most about 263 KB whatever the pixels are. The
    // old 5 MiB limit sat above the request cap, so its message was unreachable
    // and a too-big avatar got the middleware's generic refusal instead.
    const padded = Buffer.alloc(400 * 1024, 0);
    PNG_SIGNATURE.copy(padded);
    const result = validateAvatarDataUrl(imageDataUrl("image/png", padded));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/too large.*KiB/);
  });
});
