import { describe, it, expect } from "vitest";
import { PREF_GROUPS } from "@/components/auth/unsubscribe-prefs";
import {
  PREFERENCE_COPY,
  UNSUBSCRIBABLE_COLUMNS,
  isSecurityColumn,
} from "@/lib/notifications/columns";

/**
 * /unsubscribe is reached with a token from an email footer, and the token can
 * only change UNSUBSCRIBABLE_COLUMNS. A row outside that list would be a switch
 * that moves, says "Saved." and changes nothing; a column missing from the
 * rows is mail the recipient has no way to stop from the link they were sent.
 */
describe("PREF_GROUPS", () => {
  const rows = PREF_GROUPS.flatMap((group) => group.rows);

  it("lists exactly the columns the token can change", () => {
    expect(rows.map((row) => row.key).sort()).toEqual(
      [...UNSUBSCRIBABLE_COLUMNS].sort(),
    );
  });

  it("has no security group and no security row", () => {
    expect(PREF_GROUPS.map((group) => group.label)).not.toContain("Security");
    for (const { key } of rows) {
      expect(isSecurityColumn(key), key).toBe(false);
    }
  });

  it("takes every label and description from the shared table", () => {
    for (const { key, label, description } of rows) {
      expect(label, key).toBe(PREFERENCE_COPY[key].label);
      expect(description, key).toBe(PREFERENCE_COPY[key].description);
    }
  });

  it("keeps the Critical findings switch", () => {
    expect(rows.map((row) => row.key)).toContain("email_critical_findings");
  });
});
