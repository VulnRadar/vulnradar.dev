import { describe, it, expect } from "vitest";
import { pageChecks } from "@/lib/scanner/checks/page-checks";
import {
  buildPageContext,
  redactSetCookie,
  redactValueAttribute,
} from "@/lib/scanner/page-context";

/**
 * Evidence is stored with the scan, shown in the UI, exported in reports and
 * can be shared by public link. A cookie value is frequently a live session id
 * or a bearer token, and on an authenticated scan it is the scanning user's own
 * session. Eight page checks used to put the whole Set-Cookie line, value
 * included, into their excerpts; one of them is specifically the check that
 * finds JWTs.
 *
 * This runs EVERY page check against a response built to trip as many cookie
 * and form checks as possible, and asserts the secret never appears in any
 * evidence or excerpt. A new check that excerpts `c.raw` fails here by name.
 */
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJyb2xlIjoiYWRtaW4ifQ.TOPSECRETSIGNATUREsegmentABCDEF123456";
const SESSION = "s3ss10n-v4lue-that-must-never-leak-9f8e7d";
const PASSWORD = "hunter2-prefilled-password";

describe("page check evidence never contains a secret value", () => {
  const headers = new Headers();
  // Every attribute mistake at once: no Secure, no HttpOnly, SameSite=None,
  // a broad Domain and a __Host- prefix on the wrong path.
  headers.append("set-cookie", `session=${JWT}; Path=/; SameSite=None`);
  headers.append("set-cookie", `sessionid=${SESSION}; Domain=.example.com`);
  headers.append("set-cookie", `__Host-sid=${SESSION}; Path=/app`);
  headers.append("cache-control", "public, max-age=600");
  const body = `<!doctype html><html><body>
    <form action="http://example.com/login" method="post">
      <input type="password" name="pw" value="${PASSWORD}">
    </form></body></html>`;
  const ctx = buildPageContext("https://example.com/", headers, body);

  it("produces findings to inspect, so the assertion below is not vacuous", () => {
    const fired = pageChecks.filter((c) => {
      try {
        return c.run(ctx) !== null;
      } catch {
        return false;
      }
    });
    expect(fired.length).toBeGreaterThan(3);
  });

  it("leaks no cookie value, token or password into evidence", () => {
    const leaks: string[] = [];
    for (const check of pageChecks) {
      let result;
      try {
        result = check.run(ctx);
      } catch {
        continue;
      }
      if (!result) continue;
      const text = [
        result.evidence,
        ...(result.excerpts ?? []).map((e) => e.value),
      ].join("\n");
      for (const secret of [JWT, SESSION, PASSWORD, "TOPSECRETSIGNATURE"]) {
        if (text.includes(secret))
          leaks.push(`${check.id} leaks ${secret.slice(0, 12)}...`);
      }
    }
    expect(leaks).toEqual([]);
  });
});

describe("redactSetCookie", () => {
  it("keeps the name and every attribute, and replaces only the value", () => {
    expect(redactSetCookie("sid=abc123; Path=/; HttpOnly; Secure")).toBe(
      "sid=<redacted, 6 chars>; Path=/; HttpOnly; Secure",
    );
  });

  it("handles a cookie with no attributes", () => {
    expect(redactSetCookie("sid=abc123")).toBe("sid=<redacted, 6 chars>");
  });

  it("leaves an empty value alone, since there is nothing to hide", () => {
    expect(redactSetCookie("sid=; Max-Age=0")).toBe("sid=; Max-Age=0");
  });

  it("keeps an = inside the value from splitting it wrongly", () => {
    // base64 padding is the common case.
    expect(redactSetCookie("t=YWJj==; Secure")).toBe(
      "t=<redacted, 6 chars>; Secure",
    );
  });
});

describe("redactValueAttribute", () => {
  it("replaces quoted and unquoted value attributes", () => {
    expect(redactValueAttribute('<input type="password" value="pw1">')).toBe(
      '<input type="password" value="<redacted>">',
    );
    expect(redactValueAttribute("<input value='pw2' name=x>")).toBe(
      '<input value="<redacted>" name=x>',
    );
    expect(redactValueAttribute("<input value=pw3>")).toBe(
      '<input value="<redacted>">',
    );
  });

  it("does not touch data-value or other attributes ending in value", () => {
    expect(redactValueAttribute('<input data-value="keep">')).toBe(
      '<input data-value="keep">',
    );
  });
});
