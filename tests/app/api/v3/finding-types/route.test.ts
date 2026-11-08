import { describe, it, expect } from "vitest";
import { allCheckDefs } from "@/lib/scanner/registry";
import * as route from "@/app/api/v3/finding-types/route";

describe("GET /api/v3/finding-types", () => {
  it("is rendered at build, not per request", () => {
    expect(route.dynamic).toBe("force-static");
  });

  it("tells clients they may keep it for an hour", async () => {
    const res = await route.GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, must-revalidate",
    );
  });

  it("lists every registered check", async () => {
    const json = await (await route.GET()).json();

    expect(json.success).toBe(true);
    expect(json.count).toBe(allCheckDefs.length);
    expect(json.data).toHaveLength(allCheckDefs.length);
    expect(Object.keys(json.data[0]).sort()).toEqual([
      "category",
      "description",
      "id",
      "severity",
      "title",
      "type",
    ]);
  });
});
