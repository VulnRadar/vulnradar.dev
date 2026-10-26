import { describe, expect, it } from "vitest";

import { ERROR_CODES, type ErrorCode } from "@/lib/api/error-codes";
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  WWW_AUTHENTICATE_BEARER,
  buildError,
  errorBody,
  errorHeaders,
  type BuildErrorInput,
} from "@/lib/api/error-envelope";

const base: BuildErrorInput = {
  version: "v4",
  status: 400,
  message: "Nope.",
  requestId: "req-1",
};

async function parse(input: BuildErrorInput) {
  const response = buildError(input);
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}

describe("buildError: the v4 envelope", () => {
  it("is flat: error, code, requestId, and details only when given", async () => {
    const { status, body, headers } = await parse({
      ...base,
      status: 422,
      code: "INVALID_REQUEST",
      details: { issues: [{ path: "url", message: "Required" }] },
    });
    expect(status).toBe(422);
    expect(body).toEqual({
      error: "Nope.",
      code: "INVALID_REQUEST",
      requestId: "req-1",
      details: { issues: [{ path: "url", message: "Required" }] },
    });
    expect(headers.get("content-type")).toMatch(/application\/json/);
  });

  it("leaves details out when there are none", async () => {
    const { body } = await parse(base);
    expect(Object.keys(body).sort()).toEqual(["code", "error", "requestId"]);
  });

  it("falls back to the generic code of the status", async () => {
    expect((await parse({ ...base, status: 404 })).body.code).toBe("NOT_FOUND");
    expect((await parse({ ...base, status: 500 })).body.code).toBe(
      "INTERNAL_ERROR",
    );
  });

  it("never marks a maintenance 503 with paused in v4", async () => {
    const { body } = await parse({
      ...base,
      status: 503,
      code: "SERVICE_PAUSED",
    });
    expect(body.code).toBe("SERVICE_PAUSED");
    expect(body).not.toHaveProperty("paused");
  });
});

describe("buildError: the other spaces", () => {
  it.each(["v3", "internal", "permalink", "other"] as const)(
    "adds paused: true to a maintenance 503 in %s so existing readers keep working",
    async (version) => {
      const { body } = await parse({
        ...base,
        version,
        status: 503,
        code: "SERVICE_PAUSED",
      });
      expect(body.paused).toBe(true);
      expect(body.code).toBe("SERVICE_PAUSED");
    },
  );

  it("adds paused only to the maintenance code, not to every 503", async () => {
    const { body } = await parse({
      ...base,
      version: "v3",
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(body).not.toHaveProperty("paused");
  });

  it("does not add paused to errors that are not 503s", async () => {
    const { body } = await parse({ ...base, version: "v3", status: 403 });
    expect(body).not.toHaveProperty("paused");
  });
});

describe("buildError: headers", () => {
  const statuses = Array.from(
    new Set(Object.values(ERROR_CODES).flatMap((spec) => spec.statuses)),
  );

  it.each(statuses)("never lets a %i be cached", (status) => {
    expect(errorHeaders({ ...base, status }).get("cache-control")).toBe(
      "no-store",
    );
  });

  it.each([429, 503])("sends Retry-After on every %i", (status) => {
    for (const version of [
      "v3",
      "v4",
      "internal",
      "permalink",
      "other",
    ] as const) {
      const wait = errorHeaders({ ...base, version, status }).get(
        "retry-after",
      );
      expect(wait, `${version} ${status}`).toMatch(/^[1-9][0-9]*$/);
    }
  });

  it("sends a Retry-After for every code that travels with 429 or 503", () => {
    for (const [name, spec] of Object.entries(ERROR_CODES)) {
      for (const status of spec.statuses.filter(
        (s) => s === 429 || s === 503,
      )) {
        const wait = errorHeaders({
          ...base,
          status,
          code: name as ErrorCode,
        }).get("retry-after");
        expect(Number(wait), name).toBeGreaterThan(0);
      }
    }
  });

  it("uses the fixed wait of a code that has one, and the default otherwise", () => {
    const wait = (code: ErrorCode, status: number) =>
      errorHeaders({ ...base, status, code }).get("retry-after");
    expect(wait("CONCURRENT_SCAN_LIMIT", 429)).toBe("10");
    expect(wait("SERVICE_PAUSED", 503)).toBe("300");
    expect(wait("DAILY_LIMIT", 429)).toBe(String(DEFAULT_RETRY_AFTER_SECONDS));
    expect(wait("SERVICE_UNAVAILABLE", 503)).toBe(
      String(DEFAULT_RETRY_AFTER_SECONDS),
    );
  });

  it("lets the caller's wait win, rounded up to whole seconds and never below one", () => {
    const wait = (retryAfter: number, status = 429) =>
      errorHeaders({ ...base, status, retryAfter }).get("retry-after");
    expect(wait(42)).toBe("42");
    expect(wait(4.2)).toBe("5");
    expect(wait(0)).toBe("1");
    expect(wait(-5)).toBe("1");
    expect(wait(Number.NaN)).toBe(String(DEFAULT_RETRY_AFTER_SECONDS));
    expect(wait(Infinity)).toBe(String(DEFAULT_RETRY_AFTER_SECONDS));
  });

  it("sends Retry-After on a status that needs none when the caller asks, like a brownout 410", () => {
    expect(
      errorHeaders({ ...base, status: 410, retryAfter: 1800 }).get(
        "retry-after",
      ),
    ).toBe("1800");
    expect(
      errorHeaders({ ...base, status: 410 }).get("retry-after"),
    ).toBeNull();
    expect(
      errorHeaders({ ...base, status: 400 }).get("retry-after"),
    ).toBeNull();
  });

  it("challenges a v4 401 with the Bearer realm, and only a 401", () => {
    expect(errorHeaders({ ...base, status: 401 }).get("www-authenticate")).toBe(
      WWW_AUTHENTICATE_BEARER,
    );
    expect(WWW_AUTHENTICATE_BEARER).toBe('Bearer realm="VulnRadar"');
    for (const status of [400, 403, 404, 429, 500, 503]) {
      expect(
        errorHeaders({ ...base, status }).get("www-authenticate"),
        String(status),
      ).toBeNull();
    }
  });

  it("does not challenge a 401 outside v4 unless told to", () => {
    for (const version of ["v3", "internal", "permalink", "other"] as const) {
      expect(
        errorHeaders({ ...base, version, status: 401 }).get("www-authenticate"),
        version,
      ).toBeNull();
    }
    expect(
      errorHeaders({
        ...base,
        version: "v3",
        status: 401,
        bearerChallenge: true,
      }).get("www-authenticate"),
    ).toBe(WWW_AUTHENTICATE_BEARER);
    expect(
      errorHeaders({ ...base, status: 401, bearerChallenge: false }).get(
        "www-authenticate",
      ),
    ).toBeNull();
  });

  it("keeps extra headers a caller adds, but never makes an error cacheable", () => {
    const headers = errorHeaders({
      ...base,
      status: 429,
      headers: {
        Link: "</api/v4/scan>; rel=successor-version",
        "Cache-Control": "public, max-age=600",
        "Retry-After": "30",
      },
    });
    expect(headers.get("link")).toContain("successor-version");
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("retry-after")).toBe("30");
  });
});

describe("buildError: bad input", () => {
  it.each([200, 301, 399, 600, 4.5, Number.NaN])(
    "refuses %s as an error status",
    (status) => {
      expect(() => buildError({ ...base, status })).toThrow(RangeError);
      expect(() => errorBody({ ...base, status })).toThrow(RangeError);
      expect(() => errorHeaders({ ...base, status })).toThrow(RangeError);
    },
  );
});
