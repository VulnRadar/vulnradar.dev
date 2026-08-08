import { describe } from "vitest";
import { jwtChecks } from "@/lib/scanner/checks/page-checks/jwt";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

// Generated fixtures, decoded here for reference:
//   ALG_NONE:  header {"alg":"none","typ":"JWT"}, payload {"sub":"1234567890","name":"John Doe","role":"admin"}
//   NO_EXP:    header {"alg":"HS256","typ":"JWT"}, payload {"sub":"1234567890","name":"John Doe"} (no exp)
//   WITH_EXP:  header {"alg":"HS256","typ":"JWT"}, payload {..., "exp":1999999999}
const ALG_NONE_TOKEN =
  "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwicm9sZSI6ImFkbWluIn0.";
const NO_EXP_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.sig123abc";
const WITH_EXP_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiZXhwIjoxOTk5OTk5OTk5fQ.sig123abc";

const fixtures: PageCheckFixtures = {
  "page-jwt-alg-none": [
    {
      description: "alg:none JWT in an inline script",
      body: `<script>var t = "${ALG_NONE_TOKEN}";</script>`,
      expect: "fire",
      evidenceIncludes: "none",
    },
    {
      description: "alg:none JWT as a cookie value",
      cookies: [`session=${ALG_NONE_TOKEN}; Path=/`],
      expect: "fire",
    },
    {
      description: "HS256 JWT is not flagged by the alg:none check",
      body: `<script>var t = "${WITH_EXP_TOKEN}";</script>`,
      expect: "skip",
    },
    {
      description: "no JWT-shaped value present",
      body: `<script>var t = "hello world";</script>`,
      expect: "skip",
    },
  ],
  "page-jwt-missing-exp-claim": [
    {
      description: "JWT payload has no exp claim",
      body: `<script>var t = "${NO_EXP_TOKEN}";</script>`,
      expect: "fire",
      evidenceIncludes: "exp",
    },
    {
      description: "JWT payload has an exp claim",
      body: `<script>var t = "${WITH_EXP_TOKEN}";</script>`,
      expect: "skip",
    },
    {
      description: "no JWT-shaped value present",
      body: `<script>var t = "hello world";</script>`,
      expect: "skip",
    },
  ],
  "page-jwt-in-web-storage": [
    {
      description: "localStorage.setItem with a token-shaped key",
      body: `<script>localStorage.setItem("access_token", "abc123");</script>`,
      expect: "fire",
      evidenceIncludes: "localstorage",
    },
    {
      description: "sessionStorage.setItem with a jwt-shaped key",
      body: `<script>sessionStorage.setItem("jwt", jwtValue);</script>`,
      expect: "fire",
    },
    {
      description: "localStorage.setItem with an unrelated key",
      body: `<script>localStorage.setItem("theme", "dark");</script>`,
      expect: "skip",
    },
    {
      description: "no inline script at all",
      body: `<html><body>Hello</body></html>`,
      expect: "skip",
    },
  ],
  "page-jwt-cookie-not-httponly": [
    {
      description: "JWT-shaped cookie value without HttpOnly",
      cookies: [`session=${WITH_EXP_TOKEN}; Secure; Path=/`],
      expect: "fire",
      evidenceIncludes: "session",
    },
    {
      description: "JWT-shaped cookie value with HttpOnly",
      cookies: [`session=${WITH_EXP_TOKEN}; Secure; HttpOnly; Path=/`],
      expect: "skip",
    },
    {
      description: "ordinary cookie value is not JWT-shaped",
      cookies: [`theme=dark; Path=/`],
      expect: "skip",
    },
  ],
};

describe("page-checks/jwt", () => {
  runPageCheckTests(jwtChecks, fixtures);
});
