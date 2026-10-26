import { vi } from "vitest";
import { NextRequest } from "next/server";
import { describeBearerScheme } from "@/tests/lib/api/_bearer-scheme-cases";

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const { POST } = await import("@/app/api/v3/scan/verify/route");

describeBearerScheme("POST /api/v3/scan/verify", {
  validateApiKey: mockValidateApiKey,
  getSession: mockGetSession,
  call: (authorization) =>
    POST(
      new NextRequest("http://localhost/api/v3/scan/verify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization },
        body: JSON.stringify({ scanHistoryId: 1 }),
      }),
    ),
});
