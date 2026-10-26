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

const { GET, PATCH, DELETE } = await import("@/app/api/v3/history/[id]/route");

describeBearerScheme("GET /api/v3/history/[id]", {
  validateApiKey: mockValidateApiKey,
  getSession: mockGetSession,
  call: (authorization) => {
    const request = new NextRequest("http://localhost/api/v3/history/1", {
      method: "GET",
      headers: { authorization },
    });
    return GET(request, { params: Promise.resolve({ id: "1" }) });
  },
});

describeBearerScheme("PATCH /api/v3/history/[id]", {
  validateApiKey: mockValidateApiKey,
  getSession: mockGetSession,
  call: (authorization) => {
    const request = new NextRequest("http://localhost/api/v3/history/1", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify({}),
    });
    return PATCH(request, { params: Promise.resolve({ id: "1" }) });
  },
});

describeBearerScheme("DELETE /api/v3/history/[id]", {
  validateApiKey: mockValidateApiKey,
  getSession: mockGetSession,
  call: (authorization) => {
    const request = new NextRequest("http://localhost/api/v3/history/1", {
      method: "DELETE",
      headers: { authorization },
    });
    return DELETE(request, { params: Promise.resolve({ id: "1" }) });
  },
});
