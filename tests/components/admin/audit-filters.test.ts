import { describe, it, expect } from "vitest";
import {
  EMPTY_AUDIT_FILTERS,
  auditFilterParams,
  hasActiveAuditFilters,
} from "@/components/admin/audit/audit-filters";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");

describe("auditFilterParams", () => {
  it("sends nothing for the empty filter", () => {
    expect(auditFilterParams(EMPTY_AUDIT_FILTERS, NOW).toString()).toBe("");
  });

  it("turns each control into the parameter the route reads", () => {
    const params = auditFilterParams(
      {
        category: "security",
        q: "  203.0.113.9 ",
        range: "7d",
        admin: { id: 4, label: "Ada" },
        target: { id: 19, label: "user #19" },
      },
      NOW,
    );
    expect(params.get("category")).toBe("security");
    expect(params.get("q")).toBe("203.0.113.9");
    expect(params.get("adminId")).toBe("4");
    expect(params.get("targetUserId")).toBe("19");
    expect(params.get("from")).toBe("2026-10-03T12:00:00.000Z");
  });

  it("measures the 24 hour range from the clock it is given", () => {
    const params = auditFilterParams(
      { ...EMPTY_AUDIT_FILTERS, range: "24h" },
      NOW,
    );
    expect(params.get("from")).toBe("2026-10-09T12:00:00.000Z");
  });

  it("never sends the person's label, which is only for the chip", () => {
    const params = auditFilterParams(
      {
        ...EMPTY_AUDIT_FILTERS,
        target: { id: 5, label: "secret@example.test" },
      },
      NOW,
    );
    expect(params.toString()).not.toContain("secret");
  });
});

describe("hasActiveAuditFilters", () => {
  it("is false for the empty filter and for a blank search", () => {
    expect(hasActiveAuditFilters(EMPTY_AUDIT_FILTERS)).toBe(false);
    expect(hasActiveAuditFilters({ ...EMPTY_AUDIT_FILTERS, q: "   " })).toBe(
      false,
    );
  });

  it("is true when any one control is set", () => {
    expect(
      hasActiveAuditFilters({ ...EMPTY_AUDIT_FILTERS, category: "roles" }),
    ).toBe(true);
    expect(
      hasActiveAuditFilters({ ...EMPTY_AUDIT_FILTERS, range: "24h" }),
    ).toBe(true);
    expect(
      hasActiveAuditFilters({
        ...EMPTY_AUDIT_FILTERS,
        admin: { id: 1, label: "x" },
      }),
    ).toBe(true);
    expect(
      hasActiveAuditFilters({
        ...EMPTY_AUDIT_FILTERS,
        target: { id: 1, label: "x" },
      }),
    ).toBe(true);
  });
});
