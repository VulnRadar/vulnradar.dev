import { describe, expect, it } from "vitest";

import { API_VERSION_HEADER, apiVersionOf } from "@/lib/api/versions";

const request = (url: string, marker?: string) => ({
  url,
  headers: new Headers(
    marker === undefined ? {} : { [API_VERSION_HEADER]: marker },
  ),
});

describe("API_VERSION_HEADER", () => {
  it("is the lowercase marker name the middleware sets", () => {
    expect(API_VERSION_HEADER).toBe("x-vr-api-version");
  });
});

describe("apiVersionOf", () => {
  it("lets the marker win when it is v3 or v4", () => {
    expect(apiVersionOf(request("https://x.test/api/v4/scan", "v3"))).toBe(
      "v3",
    );
    expect(apiVersionOf(request("https://x.test/api/v3/scan", "v4"))).toBe(
      "v4",
    );
    expect(apiVersionOf(request("https://x.test/api/internal/x", "v4"))).toBe(
      "v4",
    );
  });

  it("falls back to the URL when there is no marker, and /api/v4 is v4", () => {
    expect(apiVersionOf(request("https://x.test/api/v4/history/abc"))).toBe(
      "v4",
    );
    expect(apiVersionOf(request("https://x.test/api/v4/auth/me?x=1"))).toBe(
      "v4",
    );
  });

  it("never lets a handler reached without the header leak the v3 superset under a v4 URL", () => {
    for (const marker of ["", "internal", "permalink", "V4", "v5", "v3,v4"]) {
      expect(
        apiVersionOf(request("https://x.test/api/v4/scan/status/abc", marker)),
        JSON.stringify(marker),
      ).toBe("v4");
    }
  });

  it("answers v3 for everything else when there is no usable marker", () => {
    expect(apiVersionOf(request("https://x.test/api/v3/scan"))).toBe("v3");
    expect(
      apiVersionOf(request("https://x.test/api/internal/history/abc")),
    ).toBe("v3");
    expect(apiVersionOf(request("https://x.test/api/version"))).toBe("v3");
    expect(apiVersionOf(request("https://x.test/"))).toBe("v3");
    expect(
      apiVersionOf(request("https://x.test/api/v3/scan", "internal")),
    ).toBe("v3");
  });

  it("does not take the version from the query string or the host", () => {
    expect(
      apiVersionOf(request("https://x.test/api/v3/scan?next=/api/v4/scan")),
    ).toBe("v3");
    expect(apiVersionOf(request("https://api/v4/scan/"))).toBe("v3");
    expect(apiVersionOf(request("https://x.test/api/v4"))).toBe("v3");
    expect(apiVersionOf(request("https://x.test/api/v40/scan"))).toBe("v3");
  });

  it("reads a path-only URL", () => {
    expect(apiVersionOf(request("/api/v4/scan"))).toBe("v4");
    expect(apiVersionOf(request("/api/v3/scan?x=/api/v4/y"))).toBe("v3");
  });

  it("accepts a real Request", () => {
    expect(
      apiVersionOf(
        new Request("https://x.test/api/v4/scan", { method: "POST" }),
      ),
    ).toBe("v4");
    expect(
      apiVersionOf(
        new Request("https://x.test/api/v3/scan", {
          headers: { "x-vr-api-version": "v4" },
        }),
      ),
    ).toBe("v4");
  });
});
