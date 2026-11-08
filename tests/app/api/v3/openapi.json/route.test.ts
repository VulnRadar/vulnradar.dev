import { describe, it, expect } from "vitest";
import * as route from "@/app/api/v3/openapi.json/route";

describe("GET /api/v3/openapi.json", () => {
  it("is rendered at build, not per request", () => {
    expect(route.dynamic).toBe("force-static");
  });

  it("serves the document with an hour's Cache-Control", async () => {
    const res = route.GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, must-revalidate",
    );
    expect(json.openapi).toMatch(/^3\.1/);
  });
});
