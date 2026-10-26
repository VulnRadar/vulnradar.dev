import { vi } from "vitest";
import { NextRequest } from "next/server";
import {
  describeBearerScheme,
  runtimeConfigDefaults,
} from "@/tests/lib/api/_bearer-scheme-cases";

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock("@/lib/config/runtime-config", () => runtimeConfigDefaults());

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const { POST } = await import("@/app/api/v3/scan/bulk/route");

describeBearerScheme("POST /api/v3/scan/bulk", {
  validateApiKey: mockValidateApiKey,
  getSession: mockGetSession,
  call: (authorization) => {
    const request = new NextRequest("http://localhost/api/v3/scan/bulk", {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify({}),
    });
    return POST(request);
  },
});
