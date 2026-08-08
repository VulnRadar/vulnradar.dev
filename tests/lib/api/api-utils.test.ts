import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for lib/api/api-utils.ts: ApiResponse, requireAuth, Validate,
 * parseBody, safeQuery, and withErrorHandling. Every route in the app
 * depends on these helpers, so a gap here is a gap that potentially
 * affects every route.
 *
 * Mocked at the database boundary: pool.query. getSession is mocked
 * too, the same way tests/lib/auth/authorization.test.ts mocks it,
 * except api-utils.ts imports getSession from "@/lib/auth/auth"
 * directly rather than the "@/lib/auth" barrel.
 *
 * parseBody is exercised with real, unmocked Request/Headers objects
 * (Node's global fetch implementation) rather than a hand-rolled
 * stand-in, since request body/header parsing is exactly the thing
 * under test.
 */

type Row = Record<string, unknown>;

const queries: { sql: string; params: unknown[] }[] = [];
let queryImpl: (
  sql: string,
  params: unknown[],
) => Promise<{ rows: Row[] }> = async () => ({ rows: [] });

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  return queryImpl(sql, params);
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

let mockSession: { userId: number; email: string } | null = null;

vi.mock("@/lib/auth/auth", () => ({
  getSession: vi.fn(async () => mockSession),
}));

const {
  ApiResponse,
  requireAuth,
  Validate,
  parseBody,
  safeQuery,
  withErrorHandling,
} = await import("@/lib/api/api-utils");
const { ERROR_MESSAGES } = await import("@/lib/config/constants");

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  queryImpl = async () => ({ rows: [] });
  mockSession = null;
});

describe("ApiResponse", () => {
  it("success defaults to 200 and echoes the data", async () => {
    const res = ApiResponse.success({ ok: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("success accepts a custom status", () => {
    const res = ApiResponse.success({ ok: true }, 201);
    expect(res.status).toBe(201);
  });

  it("error defaults to 400 with a custom message", async () => {
    const res = ApiResponse.error("custom message");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "custom message", status: 400 });
  });

  it("error accepts a custom status", () => {
    const res = ApiResponse.error("nope", 422);
    expect(res.status).toBe(422);
  });

  it("badRequest defaults its message and is a 400", async () => {
    const res = ApiResponse.badRequest();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/could not be processed/i);
  });

  it("unauthorized defaults to ERROR_MESSAGES.UNAUTHORIZED and is a 401", async () => {
    const res = ApiResponse.unauthorized();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe(ERROR_MESSAGES.UNAUTHORIZED);
  });

  it("forbidden defaults to ERROR_MESSAGES.FORBIDDEN and is a 403", async () => {
    const res = ApiResponse.forbidden();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(ERROR_MESSAGES.FORBIDDEN);
  });

  it("notFound defaults to ERROR_MESSAGES.NOT_FOUND and is a 404", async () => {
    const res = ApiResponse.notFound();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe(ERROR_MESSAGES.NOT_FOUND);
  });

  it("methodNotAllowed is a 405", () => {
    expect(ApiResponse.methodNotAllowed().status).toBe(405);
  });

  it("conflict is a 409", () => {
    expect(ApiResponse.conflict().status).toBe(409);
  });

  it("tooManyRequests is a 429 with no Retry-After header by default", () => {
    const res = ApiResponse.tooManyRequests();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("tooManyRequests sets Retry-After when given", () => {
    const res = ApiResponse.tooManyRequests("slow down", 30);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("serverError defaults to ERROR_MESSAGES.SERVER_ERROR and is a 500", async () => {
    const res = ApiResponse.serverError();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(ERROR_MESSAGES.SERVER_ERROR);
  });
});

describe("requireAuth", () => {
  it("is unauthorized when there is no session", async () => {
    mockSession = null;
    const result = await requireAuth();
    expect(result.authorized).toBe(false);
    expect(result.session).toBeNull();
    expect(result.error?.status).toBe(401);
  });

  it("is authorized when the session's account is active (disabled_at null)", async () => {
    mockSession = { userId: 1, email: "a@example.com" };
    queryImpl = async () => ({ rows: [{ disabled_at: null }] });
    const result = await requireAuth();
    expect(result.authorized).toBe(true);
    expect(result.error).toBeNull();
    expect(result.session).toEqual(mockSession);
  });

  it("is forbidden with ACCOUNT_DISABLED when the account is disabled", async () => {
    mockSession = { userId: 1, email: "a@example.com" };
    queryImpl = async () => ({
      rows: [{ disabled_at: "2024-01-01T00:00:00Z" }],
    });
    const result = await requireAuth();
    expect(result.authorized).toBe(false);
    expect(result.session).toBeNull();
    expect(result.error?.status).toBe(403);
    expect((await result.error!.json()).error).toBe(
      ERROR_MESSAGES.ACCOUNT_DISABLED,
    );
  });

  it("queries disabled_at by session.userId", async () => {
    mockSession = { userId: 77, email: "a@example.com" };
    queryImpl = async () => ({ rows: [{ disabled_at: null }] });
    await requireAuth();
    expect(queries[0].sql).toContain(
      "SELECT disabled_at FROM users WHERE id = $1",
    );
    expect(queries[0].params).toEqual([77]);
  });
});

describe("Validate", () => {
  describe("required", () => {
    it("rejects falsy values", () => {
      expect(Validate.required(undefined, "Name")).toBe("Name is required");
      expect(Validate.required(null, "Name")).toBe("Name is required");
      expect(Validate.required("", "Name")).toBe("Name is required");
    });

    it("accepts a truthy value", () => {
      expect(Validate.required("x", "Name")).toBeNull();
      expect(Validate.required(1, "Name")).toBeNull();
    });
  });

  describe("email", () => {
    it("rejects a non-string or a string without @", () => {
      expect(Validate.email("not-an-email")).toMatch(/valid email/i);
      expect(Validate.email(123 as unknown as string)).toMatch(/valid email/i);
    });

    it("accepts any string containing @", () => {
      expect(Validate.email("a@b.com")).toBeNull();
    });
  });

  describe("password", () => {
    it("rejects a password shorter than the minimum (default 8)", () => {
      expect(Validate.password("short")).toMatch(/at least 8 characters/);
    });

    it("accepts a password meeting the default minimum", () => {
      expect(Validate.password("longenough")).toBeNull();
    });

    it("honors a custom minLength", () => {
      expect(Validate.password("1234567890", 12)).toMatch(
        /at least 12 characters/,
      );
      expect(Validate.password("123456789012", 12)).toBeNull();
    });
  });

  describe("string", () => {
    it("rejects a non-string value", () => {
      expect(Validate.string(42, "Field")).toMatch(/at least 1 characters/);
    });

    it("rejects a value under the minLength after trimming", () => {
      expect(Validate.string("  a  ", "Field", 2)).toMatch(
        /at least 2 characters/,
      );
    });

    it("accepts a value meeting minLength", () => {
      expect(Validate.string("ab", "Field", 2)).toBeNull();
    });

    it("rejects a value over maxLength", () => {
      expect(Validate.string("abcdef", "Field", 1, 5)).toMatch(
        /cannot exceed 5 characters/,
      );
    });

    it("accepts a value within [minLength, maxLength]", () => {
      expect(Validate.string("abc", "Field", 1, 5)).toBeNull();
    });
  });

  describe("url", () => {
    it("accepts http and https URLs", () => {
      expect(Validate.url("http://example.com")).toBeNull();
      expect(Validate.url("https://example.com/path")).toBeNull();
    });

    it("rejects a non-http(s) protocol", () => {
      expect(Validate.url("ftp://example.com")).toMatch(
        /http or https protocol/,
      );
    });

    it("rejects an unparsable URL", () => {
      expect(Validate.url("not a url")).toBe("Invalid URL format");
    });
  });

  describe("pattern", () => {
    it("returns null on a match and the message otherwise", () => {
      expect(
        Validate.pattern("abc123", "Field", /^[a-z]+\d+$/, "bad"),
      ).toBeNull();
      expect(Validate.pattern("!!!", "Field", /^[a-z]+\d+$/, "bad")).toBe(
        "bad",
      );
    });
  });

  describe("multiple", () => {
    it("returns the first non-null error", () => {
      expect(Validate.multiple([null, "second error", "third error"])).toBe(
        "second error",
      );
    });

    it("returns null when every check passed", () => {
      expect(Validate.multiple([null, null])).toBeNull();
    });
  });
});

describe("parseBody", () => {
  it("parses a well-formed JSON body", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    const result = await parseBody<{ a: number }>(req);
    expect(result).toEqual({ success: true, data: { a: 1 } });
  });

  it("treats content-length: 0 with a JSON content-type as an empty object without reading the body", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "0",
      },
    });
    const result = await parseBody(req);
    expect(result).toEqual({ success: true, data: {} });
  });

  it("fails closed on malformed JSON with a JSON content-type", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });
    const result = await parseBody(req);
    expect(result).toEqual({
      success: false,
      error: "Failed to parse request body",
    });
  });

  it("rejects a body whose declared content-length exceeds the 1 MiB cap, without reading it", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(1024 * 1024 + 1),
      },
      body: JSON.stringify({ a: 1 }),
    });
    const result = await parseBody(req);
    expect(result).toEqual({
      success: false,
      error: "Request body exceeds 1048576 bytes",
    });
  });

  it("accepts a body exactly at the 1 MiB cap", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(1024 * 1024),
      },
      body: JSON.stringify({ a: 1 }),
    });
    const result = await parseBody(req);
    expect(result).toEqual({ success: true, data: { a: 1 } });
  });

  it("ignores a non-numeric content-length header instead of rejecting", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "not-a-number",
      },
      body: JSON.stringify({ a: 1 }),
    });
    const result = await parseBody(req);
    expect(result).toEqual({ success: true, data: { a: 1 } });
  });

  it("treats a missing content-type with no body as an empty object", async () => {
    const req = new Request("http://x", { method: "GET" });
    const result = await parseBody(req);
    expect(result).toEqual({ success: true, data: {} });
  });

  it("parses JSON via the fallback path when content-type is not application/json", async () => {
    // A string body with no explicit content-type gets a UA-assigned
    // "text/plain" content-type from the Request constructor, which
    // still isn't "multipart/form-data" -- exercises the fallback
    // branch's own JSON.parse attempt. A non-"0" content-length is
    // required here too: Node's Request does not auto-populate
    // content-length from the body, and the code treats a null/"0"
    // content-length as "no body at all" before ever trying to parse.
    const body = JSON.stringify({ b: 2 });
    const req = new Request("http://x", {
      method: "POST",
      headers: { "content-length": String(body.length) },
      body,
    });
    const result = await parseBody<{ b: number }>(req);
    expect(result).toEqual({ success: true, data: { b: 2 } });
  });

  it("fails soft (not throwing) on malformed JSON via the fallback path", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "content-length": "9" },
      body: "{not json",
    });
    const result = await parseBody(req);
    expect(result).toEqual({
      success: false,
      error: "Invalid JSON in request body",
    });
  });

  it("rejects multipart/form-data as an unsupported content-type", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    const result = await parseBody(req);
    expect(result).toEqual({
      success: false,
      error: "Unsupported content-type",
    });
  });

  it("catches an unexpected error and reports a generic failure", async () => {
    const badRequest = {
      headers: {
        get: () => {
          throw new Error("boom");
        },
      },
    } as unknown as Request;
    const result = await parseBody(badRequest);
    expect(result).toEqual({
      success: false,
      error: "Failed to parse request body",
    });
  });
});

describe("safeQuery", () => {
  it("returns the rows on success", async () => {
    queryImpl = async () => ({ rows: [{ id: 1 }] });
    const result = await safeQuery("SELECT 1", []);
    expect(result).toEqual({ success: true, rows: [{ id: 1 }] });
  });

  it("returns a generic error (not the raw DB error) when the query throws", async () => {
    queryImpl = async () => {
      throw new Error("relation does not exist: secret_table");
    };
    const result = await safeQuery("SELECT * FROM secret_table");
    expect(result).toEqual({
      success: false,
      error: "Database query failed",
    });
  });

  it("returns the same generic error when a non-Error value is thrown", async () => {
    queryImpl = async () => {
      throw "raw string failure";
    };
    const result = await safeQuery("SELECT 1");
    expect(result).toEqual({
      success: false,
      error: "Database query failed",
    });
  });
});

describe("withErrorHandling", () => {
  it("passes through a successful handler's response and its arguments", async () => {
    const handler = vi.fn(async (a: number, b: number) =>
      ApiResponse.success({ sum: a + b }),
    );
    const wrapped = withErrorHandling(handler);
    const res = await wrapped(2, 3);
    expect(handler).toHaveBeenCalledWith(2, 3);
    expect(await res.json()).toEqual({ sum: 5 });
  });

  it("converts a thrown error into a 500 instead of propagating", async () => {
    const handler = vi.fn(async () => {
      throw new Error("kaboom");
    });
    const wrapped = withErrorHandling(handler);
    const res = await wrapped();
    expect(res.status).toBe(500);
    // withErrorHandling passes its own literal message, not the
    // ERROR_MESSAGES.SERVER_ERROR default ApiResponse.serverError()
    // falls back to when called with no argument.
    expect((await res.json()).error).toBe("An unexpected error occurred");
  });
});
