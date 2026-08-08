import { describe, it, expect } from "vitest";
import { parseChangeDiff } from "@/components/admin/utils";

/**
 * parseChangeDiff turns an audit log's free-text `details` sentence into a
 * structured before/after diff for the admin UI's diff badges. Exercised
 * here against the exact sentence shapes the app actually logs (see
 * app/api/v3/admin/features/route.ts and app/api/v3/admin/route.ts), not
 * invented strings, so a future wording change that breaks parsing shows up
 * here first.
 */
describe("parseChangeDiff", () => {
  it("returns null for a non-diff details string", () => {
    expect(
      parseChangeDiff("Created url blacklist rule: bad.example.com"),
    ).toBeNull();
  });

  it("returns null for null details", () => {
    expect(parseChangeDiff(null)).toBeNull();
  });

  it("parses a system_setting_changed sentence", () => {
    expect(
      parseChangeDiff(
        'Changed "RATE_LIMIT_LOGIN_ATTEMPTS" from "(not set)" to "10"',
      ),
    ).toEqual({
      field: "RATE_LIMIT_LOGIN_ATTEMPTS",
      from: "(not set)",
      to: "10",
    });
  });

  it("parses a system_setting_reset sentence", () => {
    expect(
      parseChangeDiff(
        'Reset "RATE_LIMIT_LOGIN_ATTEMPTS" to its default (was "10")',
      ),
    ).toEqual({
      field: "RATE_LIMIT_LOGIN_ATTEMPTS",
      from: "10",
      to: "default",
    });
  });

  it("parses an update_name sentence with a trailing 'for <email>' clause", () => {
    expect(
      parseChangeDiff(
        'Changed display name from "Old Name" to "New Name" for user@example.com',
      ),
    ).toEqual({ field: "display name", from: "Old Name", to: "New Name" });
  });

  it("parses an update_email sentence with no trailing clause", () => {
    expect(
      parseChangeDiff('Changed email from "old@x.com" to "new@x.com"'),
    ).toEqual({ field: "email", from: "old@x.com", to: "new@x.com" });
  });

  it("parses an update_plan sentence with a trailing 'for <email>' clause", () => {
    expect(
      parseChangeDiff(
        'Changed subscription plan from "free" to "core_supporter" for user@example.com',
      ),
    ).toEqual({
      field: "subscription plan",
      from: "free",
      to: "core_supporter",
    });
  });

  it("handles an empty old value as '(not set)' rather than failing to match", () => {
    const diff = parseChangeDiff(
      'Changed "SUPPORT_EMAIL" from "(not set)" to "help@example.com"',
    );
    expect(diff?.from).toBe("(not set)");
    expect(diff?.to).toBe("help@example.com");
  });
});
