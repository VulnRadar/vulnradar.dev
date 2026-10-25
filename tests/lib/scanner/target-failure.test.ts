import { describe, it, expect } from "vitest";
import {
  PAGE_UNREACHABLE_INCOMPLETE,
  PAGE_UNREACHABLE_LABEL,
  ScanTargetError,
  classifyTargetFailure,
  pageUnreachableFrom,
} from "@/lib/scanner/target-failure";
import { isFailureKind } from "@/lib/scanner/failure-kinds";

/**
 * What safeFetch threw, read structurally. safeFetch's codes are the contract
 * (cross_host_redirect | timeout | tls | unreachable | blocked); the raw Node
 * and undici codes are the fallback for an error that carries none, and a
 * throw that is neither is "not the target", never "the target's fault".
 */
function withCode(code: string, message = "boom"): Error {
  return Object.assign(new Error(message), { code });
}

/** undici wraps the socket error in TypeError("fetch failed"). */
function undici(code: string): Error {
  return Object.assign(new TypeError("fetch failed"), {
    cause: withCode(code),
  });
}

describe("classifyTargetFailure", () => {
  it.each([
    ["unreachable", "target_unreachable"],
    ["timeout", "target_timeout"],
    ["tls", "target_tls"],
    ["cross_host_redirect", "target_redirect_offhost"],
    ["blocked", "target_blocked"],
  ] as const)("maps safeFetch's own code %s to %s", (code, kind) => {
    expect(classifyTargetFailure(withCode(code))).toMatchObject({ code, kind });
  });

  it("takes safeFetch's code ahead of the raw one underneath it", () => {
    const err = Object.assign(new Error("tls"), {
      code: "tls",
      cause: withCode("ECONNRESET"),
    });
    expect(classifyTargetFailure(err)?.code).toBe("tls");
  });

  it.each([
    "ECONNREFUSED",
    "ECONNRESET",
    "ECONNABORTED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EPIPE",
    "UND_ERR_SOCKET",
    "UND_ERR_CLOSED",
    "HPE_INVALID_CONSTANT",
  ])("reads %s as an unreachable target", (code) => {
    expect(classifyTargetFailure(undici(code))?.code).toBe("unreachable");
  });

  it.each([
    "ETIMEDOUT",
    "ESOCKETTIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
  ])("reads %s as a timeout", (code) => {
    expect(classifyTargetFailure(undici(code))?.code).toBe("timeout");
  });

  it.each([
    "CERT_HAS_EXPIRED",
    "CERT_UNTRUSTED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "ERR_SSL_WRONG_VERSION_NUMBER",
    "EPROTO",
  ])("reads %s as a TLS failure", (code) => {
    expect(classifyTargetFailure(undici(code))?.code).toBe("tls");
  });

  it("follows the cause chain a few links down", () => {
    const deep = Object.assign(new Error("outer"), {
      cause: Object.assign(new Error("middle"), {
        cause: Object.assign(new Error("inner"), {
          cause: withCode("ECONNREFUSED"),
        }),
      }),
    });
    expect(classifyTargetFailure(deep)?.code).toBe("unreachable");
  });

  it("does not loop forever on a cause cycle", () => {
    const a: Record<string, unknown> = { message: "a" };
    a.cause = a;
    expect(classifyTargetFailure(a)).toBeNull();
  });

  it("reads an AbortError or TimeoutError with no code as the fetch's timeout", () => {
    for (const name of ["AbortError", "TimeoutError"]) {
      const err = Object.assign(new Error("This operation was aborted"), {
        name,
      });
      expect(classifyTargetFailure(err)?.code).toBe("timeout");
    }
  });

  describe("an off-host redirect", () => {
    it("carries the host safeFetch names on the error", () => {
      const err = Object.assign(new Error("redirect"), {
        code: "cross_host_redirect",
        redirectHost: "app.example.com",
      });
      expect(classifyTargetFailure(err)).toEqual({
        code: "cross_host_redirect",
        kind: "target_redirect_offhost",
        redirectHost: "app.example.com",
      });
    });

    it("falls back to the message safeFetch has always thrown", () => {
      const err = new Error(
        "Redirect to a different host (shop.example.com) is not allowed.",
      );
      expect(classifyTargetFailure(err)).toEqual({
        code: "cross_host_redirect",
        kind: "target_redirect_offhost",
        redirectHost: "shop.example.com",
      });
    });

    it("keeps a host only for a redirect", () => {
      const err = Object.assign(new Error("x"), {
        code: "timeout",
        redirectHost: "app.example.com",
      });
      expect(classifyTargetFailure(err)).not.toHaveProperty("redirectHost");
    });
  });

  it("answers null for a throw that is not recognisably the target", () => {
    expect(classifyTargetFailure(new Error("socket exploded"))).toBeNull();
    expect(classifyTargetFailure(new TypeError("fetch failed"))).toBeNull();
    expect(classifyTargetFailure(withCode("ERR_SOMETHING_ELSE"))).toBeNull();
    expect(classifyTargetFailure("a string")).toBeNull();
    expect(classifyTargetFailure(null)).toBeNull();
    expect(classifyTargetFailure(undefined)).toBeNull();
  });

  it("only ever yields a kind the failure_kind column accepts", () => {
    for (const code of [
      "unreachable",
      "timeout",
      "tls",
      "cross_host_redirect",
      "blocked",
    ]) {
      const failure = classifyTargetFailure(withCode(code));
      expect(isFailureKind(failure?.kind)).toBe(true);
    }
  });
});

describe("pageUnreachableFrom", () => {
  it("records the code and a fixed sentence, never the raw error text", () => {
    const failure = classifyTargetFailure(
      withCode("unreachable", "connect ECONNREFUSED 10.0.0.5:443"),
    )!;
    const record = pageUnreachableFrom(failure);
    expect(record.code).toBe("unreachable");
    expect(record.message).not.toContain("10.0.0.5");
    expect(record.message.length).toBeGreaterThan(10);
  });

  it("carries the redirect host through, and only then", () => {
    const redirect = classifyTargetFailure(
      new Error(
        "Redirect to a different host (shop.example.com) is not allowed.",
      ),
    )!;
    expect(pageUnreachableFrom(redirect).redirectHost).toBe("shop.example.com");
    const timeout = classifyTargetFailure(withCode("timeout"))!;
    expect(pageUnreachableFrom(timeout)).not.toHaveProperty("redirectHost");
  });
});

describe("page-unreachable exports", () => {
  it("names the area a reader is told was not checked", () => {
    expect(PAGE_UNREACHABLE_INCOMPLETE).toBe("page-unreachable");
    expect(PAGE_UNREACHABLE_LABEL.length).toBeGreaterThan(10);
    expect(PAGE_UNREACHABLE_LABEL).not.toContain(String.fromCharCode(0x2014));
  });

  it("ScanTargetError carries the kind the job records it under", () => {
    const err = new ScanTargetError("blocked", "target_blocked");
    expect(err).toBeInstanceOf(Error);
    expect(err.failureKind).toBe("target_blocked");
    expect(err.name).toBe("ScanTargetError");
  });
});
