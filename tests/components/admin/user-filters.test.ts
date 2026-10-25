import { describe, it, expect } from "vitest";
import {
  EMPTY_USER_FILTERS,
  hasActiveUserFilters,
  userFilterParams,
} from "@/components/admin/users/user-filters";

describe("userFilterParams", () => {
  it("sends nothing for the empty filter", () => {
    expect(userFilterParams(EMPTY_USER_FILTERS).toString()).toBe("");
  });

  it("sends only the controls that are set, under the names the route reads", () => {
    expect(
      userFilterParams({
        status: "no2fa",
        role: "staff",
        plan: "free",
      }).toString(),
    ).toBe("status=no2fa&role=staff&plan=free");
    expect(
      userFilterParams({
        ...EMPTY_USER_FILTERS,
        plan: "pro_supporter",
      }).toString(),
    ).toBe("plan=pro_supporter");
  });
});

describe("hasActiveUserFilters", () => {
  it("is false only when every control is at 'all'", () => {
    expect(hasActiveUserFilters(EMPTY_USER_FILTERS)).toBe(false);
    expect(
      hasActiveUserFilters({ ...EMPTY_USER_FILTERS, status: "disabled" }),
    ).toBe(true);
    expect(hasActiveUserFilters({ ...EMPTY_USER_FILTERS, role: "ops" })).toBe(
      true,
    );
    expect(hasActiveUserFilters({ ...EMPTY_USER_FILTERS, plan: "free" })).toBe(
      true,
    );
  });
});
