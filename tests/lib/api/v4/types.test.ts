import { describe, expect, it } from "vitest";

import { V4_ROUTES } from "@/lib/api/route-registry";
import { OP_NAMES } from "@/lib/api/v4/types";

describe("OpName", () => {
  it("has the 23 operations of the v4 contract, each once", () => {
    expect(OP_NAMES).toHaveLength(23);
    expect(new Set(OP_NAMES).size).toBe(23);
  });

  it("is exactly what the route registry serves", () => {
    const served = V4_ROUTES.flatMap((route) =>
      Object.values(route.operations),
    );
    expect([...served].sort()).toEqual([...OP_NAMES].sort());
  });
});
