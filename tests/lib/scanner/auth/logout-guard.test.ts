import { describe, it, expect } from "vitest";
import {
  isLogoutUrl,
  isDestructiveUrl,
  blockedForAuthenticatedRequest,
} from "@/lib/scanner/auth/logout-guard";

describe("isLogoutUrl", () => {
  it.each([
    "https://app.example.com/logout",
    "https://app.example.com/log-out",
    "https://app.example.com/auth/sign-out",
    "https://app.example.com/users/sign_out",
    "https://app.example.com/account/logOut",
    "https://app.example.com/session/destroy",
    "https://app.example.com/sessions/revoke",
    "https://app.example.com/?logout=1",
    "https://app.example.com/?action=logout",
  ])("flags %s as a logout URL", (url) => {
    expect(isLogoutUrl(url)).toBe(true);
  });

  it.each([
    "https://app.example.com/dashboard",
    "https://app.example.com/blog/how-to-log-issues", // "log" substring, not logout
    "https://app.example.com/products/loginwear", // "login" substring, not a match
    "https://app.example.com/?redirect=/logged-in",
  ])("does not flag %s", (url) => {
    expect(isLogoutUrl(url)).toBe(false);
  });
});

describe("isDestructiveUrl", () => {
  it.each([
    "https://app.example.com/account/delete",
    "https://app.example.com/posts/42/destroy",
    "https://app.example.com/users/deactivate",
    "https://app.example.com/?action=delete",
    "https://app.example.com/?delete=1",
  ])("flags %s as destructive", (url) => {
    expect(isDestructiveUrl(url)).toBe(true);
  });

  it.each([
    "https://app.example.com/dashboard",
    "https://app.example.com/deleted-items-history", // segment isn't exactly "delete"
    "https://app.example.com/?delete=0",
    "https://app.example.com/?delete=false",
  ])("does not flag %s", (url) => {
    expect(isDestructiveUrl(url)).toBe(false);
  });
});

describe("blockedForAuthenticatedRequest", () => {
  it("returns a non-secret reason for a logout URL", () => {
    const reason = blockedForAuthenticatedRequest(
      "https://app.example.com/logout",
    );
    expect(reason).toBeTruthy();
    expect(reason).not.toMatch(/password|cookie=|token=/i);
  });

  it("returns a non-secret reason for a destructive URL", () => {
    const reason = blockedForAuthenticatedRequest(
      "https://app.example.com/account/delete",
    );
    expect(reason).toBeTruthy();
  });

  it("returns null for an ordinary page", () => {
    expect(
      blockedForAuthenticatedRequest("https://app.example.com/dashboard"),
    ).toBeNull();
  });
});
