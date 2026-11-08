import { describe, it, expect } from "vitest";
import {
  classifyPageResponse,
  detectUnusablePage,
} from "@/lib/scanner/response-classifier";
import { REFUSED_RESPONSES, SERVED_RESPONSES } from "./refused-page-fixtures";

const html = (title: string) =>
  `<html><head><title>${title}</title></head><body><p>Some text</p></body></html>`;

describe("detectUnusablePage on recorded responses", () => {
  it("has the recordings it claims to", () => {
    expect(REFUSED_RESPONSES).toHaveLength(9);
    expect(SERVED_RESPONSES).toHaveLength(3);
  });

  it.each(REFUSED_RESPONSES.map((r) => [r.name, r] as const))(
    "does not accept %s as the page",
    (_name, recorded) => {
      expect(
        detectUnusablePage(recorded.status, recorded.headers, recorded.body),
      ).not.toBeNull();
    },
  );

  it.each(SERVED_RESPONSES.map((r) => [r.name, r] as const))(
    "accepts %s as the page",
    (_name, recorded) => {
      expect(recorded.status).toBe(200);
      expect(
        detectUnusablePage(recorded.status, recorded.headers, recorded.body),
      ).toBeNull();
    },
  );
});

describe("detectUnusablePage by status", () => {
  it.each([401, 403, 407, 429, 451])("refuses %i", (status) => {
    expect(detectUnusablePage(status, new Headers(), html("Nope"))).toBe(
      `HTTP ${status} refused the scanner`,
    );
  });

  it.each([500, 502, 503, 504, 599])(
    "treats %i as a server error",
    (status) => {
      expect(detectUnusablePage(status, new Headers(), html("Oops"))).toBe(
        `HTTP ${status} server error`,
      );
    },
  );

  it.each([301, 302, 304, 307, 308])(
    "does not take a %i that was never followed for a page",
    (status) => {
      // safeFetch hands back a 3xx at its hop cap, and that response has no
      // page in it: an empty 301 was graded as missing every header.
      expect(detectUnusablePage(status, new Headers(), "")).toBe(
        `HTTP ${status} redirect not followed to a page`,
      );
    },
  );

  it.each([404, 410])("keeps grading a %i", (status) => {
    // A removed page is still a page the site served, and an API root
    // legitimately answers 404 JSON.
    expect(
      detectUnusablePage(status, new Headers(), html("Not Found")),
    ).toBeNull();
  });

  it("grades a 200 titled Forbidden", () => {
    expect(
      detectUnusablePage(200, new Headers(), html("Forbidden")),
    ).toBeNull();
  });

  it("names the challenge rather than the status when it is one", () => {
    const headers = new Headers({ "cf-mitigated": "challenge" });
    expect(detectUnusablePage(403, headers, "")).toBe(
      "cf-mitigated: challenge",
    );
  });
});

describe("classifyPageResponse", () => {
  it("calls an ordinary 200 a page", () => {
    expect(classifyPageResponse(200, new Headers(), html("Home"))).toEqual({
      kind: "page",
    });
  });

  it("calls a recognised interstitial a challenge, whatever its status", () => {
    expect(
      classifyPageResponse(
        202,
        new Headers({ "x-amzn-waf-action": "challenge" }),
        "",
      ).kind,
    ).toBe("challenge");
    expect(
      classifyPageResponse(503, new Headers(), html("Just a moment...")).kind,
    ).toBe("challenge");
  });

  it("calls a plain refusal blocked", () => {
    expect(classifyPageResponse(403, new Headers(), html("403"))).toEqual({
      kind: "blocked",
      reason: "HTTP 403 refused the scanner",
    });
  });

  it.each([301, 400, 404, 405, 410, 500, 502])(
    "calls %i an error and keeps its status",
    (status) => {
      expect(classifyPageResponse(status, new Headers(), html("x"))).toEqual({
        kind: "error",
        status,
      });
    },
  );

  it("reports the same 404 as an error and as still gradable", () => {
    // The two answers are different questions: the verdict says what the
    // response is, the gate says whether the page checks may read it.
    expect(classifyPageResponse(404, new Headers(), "").kind).toBe("error");
    expect(detectUnusablePage(404, new Headers(), "")).toBeNull();
  });
});
