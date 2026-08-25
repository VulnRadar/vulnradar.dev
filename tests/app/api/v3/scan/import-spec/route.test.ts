import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const { POST } = await import("@/app/api/v3/scan/import-spec/route");

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/scan/import-spec", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 1 });
});

describe("POST /api/v3/scan/import-spec", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ spec: {} }));
    expect(res.status).toBe(401);
  });

  it("rejects a missing spec", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects an unrecognized spec", async () => {
    const res = await POST(postRequest({ spec: { not: "a spec" } }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Unrecognized/);
  });

  it("returns targets for an OpenAPI 3 spec", async () => {
    const res = await POST(
      postRequest({
        spec: {
          openapi: "3.0.0",
          servers: [{ url: "https://api.example.com" }],
          paths: { "/health": {}, "/users/{id}": {} },
        },
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.format).toBe("openapi3");
    expect(json.count).toBe(2);
    expect(json.targets).toContain("https://api.example.com/health");
  });

  it("400s when a recognized spec yields no scannable URLs", async () => {
    const res = await POST(
      postRequest({
        spec: { openapi: "3.0.0", servers: [{ url: "/relative" }], paths: {} },
      }),
    );
    expect(res.status).toBe(400);
  });
});
