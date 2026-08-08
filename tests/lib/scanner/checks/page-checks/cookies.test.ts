import { describe } from "vitest";
import { cookieChecks } from "@/lib/scanner/checks/page-checks/cookies";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-cookie-missing-secure": [
    {
      description: "cookie without Secure on an https page",
      url: "https://example.com/",
      cookies: ["theme=dark; Path=/"],
      expect: "fire",
      evidenceIncludes: "theme",
    },
    {
      description: "cookie has Secure",
      url: "https://example.com/",
      cookies: ["theme=dark; Secure; Path=/"],
      expect: "skip",
    },
  ],
  "page-cookie-missing-httponly": [
    {
      description: "session-like cookie without HttpOnly",
      cookies: ["session_id=abc; Secure; SameSite=Lax; Path=/"],
      expect: "fire",
      evidenceIncludes: "session_id",
    },
    {
      description: "non-session cookie without HttpOnly is not flagged",
      cookies: ["theme=dark; Secure; SameSite=Lax; Path=/"],
      expect: "skip",
    },
    {
      description: "session cookie with HttpOnly",
      cookies: ["session_id=abc; Secure; HttpOnly; SameSite=Lax; Path=/"],
      expect: "skip",
    },
  ],
  "page-cookie-missing-samesite": [
    {
      description: "cookie without SameSite",
      cookies: ["id=1; Path=/"],
      expect: "fire",
    },
    {
      description: "cookie with SameSite",
      cookies: ["id=1; SameSite=Lax; Path=/"],
      expect: "skip",
    },
  ],
  "page-cookie-samesite-none-without-secure": [
    {
      description: "SameSite=None without Secure",
      cookies: ["widget=x; SameSite=None; Path=/"],
      expect: "fire",
      evidenceIncludes: "widget",
    },
    {
      description: "SameSite=None with Secure",
      cookies: ["widget=x; SameSite=None; Secure; Path=/"],
      expect: "skip",
    },
  ],
  "page-cookie-host-prefix-violation": [
    {
      description: "__Host- cookie missing Secure",
      cookies: ["__Host-session=abc; Path=/"],
      expect: "fire",
      evidenceIncludes: "__Host-session",
    },
    {
      description: "__Host- cookie with a Domain attribute (forbidden)",
      cookies: ["__Host-session=abc; Secure; Path=/; Domain=example.com"],
      expect: "fire",
    },
    {
      description: "__Secure- cookie missing Secure",
      cookies: ["__Secure-id=abc; Path=/"],
      expect: "fire",
    },
    {
      description: "properly formed __Host- cookie",
      cookies: ["__Host-session=abc; Secure; Path=/"],
      expect: "skip",
    },
  ],
  "page-cookie-session-missing-host-prefix": [
    {
      description:
        "session cookie qualifies for __Host- (Secure, Path=/, no Domain) but doesn't use it",
      url: "https://example.com/",
      cookies: ["session_id=abc; Secure; Path=/; SameSite=Lax"],
      expect: "fire",
      evidenceIncludes: "session_id",
    },
    {
      description: "already uses the __Host- prefix",
      url: "https://example.com/",
      cookies: ["__Host-session=abc; Secure; Path=/"],
      expect: "skip",
    },
    {
      description: "sets a Domain attribute, so it doesn't qualify yet",
      url: "https://example.com/",
      cookies: ["session_id=abc; Secure; Path=/; Domain=example.com"],
      expect: "skip",
    },
    {
      description: "non-session cookie is not flagged",
      url: "https://example.com/",
      cookies: ["theme=dark; Secure; Path=/"],
      expect: "skip",
    },
  ],
  "page-cookie-session-samesite-none-review": [
    {
      description: "session cookie sets SameSite=None",
      cookies: ["session_id=abc; Secure; SameSite=None; Path=/"],
      expect: "fire",
      evidenceIncludes: "session_id",
    },
    {
      description: "session cookie sets SameSite=Lax",
      cookies: ["session_id=abc; Secure; SameSite=Lax; Path=/"],
      expect: "skip",
    },
    {
      description: "non-session cookie with SameSite=None is not flagged",
      cookies: ["widget=x; Secure; SameSite=None; Path=/"],
      expect: "skip",
    },
  ],
};

describe("page-checks/cookies", () => {
  runPageCheckTests(cookieChecks, fixtures);
});
