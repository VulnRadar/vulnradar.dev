/**
 * The input rules the notification dialog and both admin notification routes
 * share. The dialog checks a link before it sends and the routes refuse the
 * same link with the same sentence, so the two can never disagree about it.
 */
import { describe, it, expect } from "vitest";
import {
  actionUrlProblem,
  firstActionUrlProblem,
  notificationInputError,
} from "@/lib/notifications/admin-input";

describe("actionUrlProblem", () => {
  it.each([
    "https://example.com/status",
    "http://example.com",
    "/pricing",
    "  /docs  ",
    "HTTPS://EXAMPLE.COM",
  ])("accepts %s", (url) => {
    expect(actionUrlProblem("action_url", url)).toBeNull();
  });

  it("treats an empty link as no button", () => {
    expect(actionUrlProblem("action_url", "")).toBeNull();
    expect(actionUrlProblem("action_url", null)).toBeNull();
    expect(actionUrlProblem("action_url", undefined)).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,<script>",
    "//evil.example/path",
    "example.com",
    "mailto:a@example.com",
  ])("refuses %s", (url) => {
    expect(actionUrlProblem("action_url", url)).toMatch(
      /^The first button's URL must start with https:\/\/, http:\/\/ or a \/ path/,
    );
  });

  it("names the second button for action_url_2", () => {
    expect(actionUrlProblem("action_url_2", "javascript:x")).toMatch(
      /^The second button's URL/,
    );
  });

  it("refuses a value that is not text", () => {
    expect(actionUrlProblem("action_url", 5)).toBe(
      "The first button's URL must be text.",
    );
  });
});

describe("firstActionUrlProblem", () => {
  it("reports the first bad link in field order", () => {
    expect(
      firstActionUrlProblem({ action_url: "/ok", action_url_2: "data:x" }),
    ).toMatch(/second button/);
    expect(firstActionUrlProblem({ action_url: "/a" })).toBeNull();
  });
});

describe("notificationInputError", () => {
  const pg = (code: string) => Object.assign(new Error("pg"), { code });

  it.each([
    ["22007", /start or end time/],
    ["22008", /start or end time/],
    ["22003", /too large/],
    ["22P02", /whole numbers/],
    ["22001", /255 characters/],
    ["23514", /listed options/],
  ])("explains Postgres %s", (code, message) => {
    expect(notificationInputError(pg(code))).toMatch(message);
  });

  it("leaves anything else to the generic 500", () => {
    expect(notificationInputError(new Error("connection reset"))).toBeNull();
    expect(notificationInputError(pg("57P01"))).toBeNull();
    expect(notificationInputError(null)).toBeNull();
  });
});
