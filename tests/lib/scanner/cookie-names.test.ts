import { describe, it, expect } from "vitest";
import {
  isCsrfTokenReadableByDesign,
  isSessionLikeName,
} from "@/lib/scanner/cookie-names";

describe("isCsrfTokenReadableByDesign", () => {
  it.each([
    "XSRF-TOKEN",
    "xsrf_token",
    "csrftoken",
    "csrf-token",
    "_csrf",
    "_csrf_token",
    "ct0",
    "  csrftoken ",
  ])("%s is readable by design", (name) => {
    expect(isCsrfTokenReadableByDesign(name)).toBe(true);
  });

  it.each(["session", "PHPSESSID", "csrftoken2", "my_csrftoken", "theme"])(
    "%s is not",
    (name) => {
      expect(isCsrfTokenReadableByDesign(name)).toBe(false);
    },
  );
});

describe("isSessionLikeName", () => {
  it.each([
    "PHPSESSID",
    "JSESSIONID",
    "sid",
    "session_id",
    "sessionid",
    "session_token",
    "laravel_session",
    "ASP.NET_SessionId",
    "connect.sid",
    "access_token",
    "remember_me",
    "MoodleSession",
    "AppSessionID",
  ])("%s is session-like", (name) => {
    expect(isSessionLikeName(name)).toBe(true);
  });

  it.each([
    "XSRF-TOKEN",
    "csrftoken",
    "ct0",
    "_csrf",
    "theme",
    "locale",
    "_ga",
    "loggedConversion",
  ])("%s is not session-like", (name) => {
    expect(isSessionLikeName(name)).toBe(false);
  });
});
