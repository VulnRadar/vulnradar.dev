/**
 * POST /api/v3/webhooks/[id]/rotate-secret answers with the webhook row and
 * its new secret. Once the address is encrypted at rest (enc-2) the url
 * column is '', so the answer opens url_encrypted rather than echoing the
 * emptied column, and never carries the ciphertext itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { encryptApiKey } from "@/lib/auth/crypto";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock("@/lib/auth", () => ({
  getSession: async () => ({ userId: 7, email: "owner@example.com" }),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
  getUserAgent: vi.fn(async () => "vitest"),
}));

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));

const { POST } = await import("@/app/api/v3/webhooks/[id]/rotate-secret/route");

const SECRET_URL = "https://discord.com/api/webhooks/1/s3cr3t-token";
let previous: string | undefined;

beforeEach(() => {
  mockQuery.mockReset();
  previous = process.env.API_KEY_ENCRYPTION_KEY;
  process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
});

afterEach(() => {
  if (previous === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = previous;
});

describe("POST /api/v3/webhooks/[id]/rotate-secret", () => {
  it("answers with the opened URL and the new secret, never the ciphertext", async () => {
    const ciphertext = encryptApiKey(SECRET_URL);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          url: "",
          url_encrypted: ciphertext,
          name: "Ops",
          type: "discord",
          active: true,
        },
      ],
    });

    const res = await POST(
      new NextRequest("http://localhost/api/v3/webhooks/10/rotate-secret", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "10" }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toContain("url_encrypted");
    expect(json.url).toBe(SECRET_URL);
    expect(json.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(json).not.toHaveProperty("url_encrypted");
    expect(JSON.stringify(json)).not.toContain(ciphertext);
  });
});
