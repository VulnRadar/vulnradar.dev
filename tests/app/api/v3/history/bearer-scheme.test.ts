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

const { GET, DELETE } = await import("@/app/api/v3/history/route");

describeBearerScheme("GET /api/v3/history", {
  validateApiKey: mockValidateApiKey,
  getSession: mockGetSession,
  call: (authorization) => {
    const request = new NextRequest("http://localhost/api/v3/history", {
      method: "GET",
      headers: { authorization },
    });
    return GET(request);
  },
});

describeBearerScheme("DELETE /api/v3/history", {
  validateApiKey: mockValidateApiKey,
  getSession: mockGetSession,
  call: (authorization) => {
    const request = new NextRequest("http://localhost/api/v3/history", {
      method: "DELETE",
      headers: { authorization },
    });
    return DELETE(request);
  },
});
