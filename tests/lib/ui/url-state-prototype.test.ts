import { describe, it, expect, afterEach, vi } from "vitest";
import { getAllQueryParams } from "@/lib/ui/url-state";

/**
 * getAllQueryParams copies every query-string key the visitor typed into an
 * object. It wrote them into a plain `{}`, so the keys and the object's
 * inherited members shared one namespace: ?__proto__=x was silently dropped
 * (assigning a string to __proto__ is a no-op), and a key the URL did not
 * have, such as `toString`, read back as Object.prototype's function rather
 * than as missing. The result now has no prototype, so what is on it is
 * exactly what the URL said.
 */

function stubSearch(search: string) {
  vi.stubGlobal("window", {
    location: { pathname: "/admin", search, hash: "" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAllQueryParams", () => {
  it("has no prototype", () => {
    stubSearch("?tab=users");
    expect(Object.getPrototypeOf(getAllQueryParams())).toBeNull();
  });

  it("keeps ?__proto__= as an ordinary key instead of dropping it", () => {
    stubSearch("?__proto__=x&tab=users");
    const params = getAllQueryParams();
    expect(Object.hasOwn(params, "__proto__")).toBe(true);
    expect(params["__proto__"]).toBe("x");
    expect(params.tab).toBe("users");
    expect(Object.getPrototypeOf(params)).toBeNull();
  });

  it("does not answer for a key the URL does not have", () => {
    stubSearch("?tab=users");
    const params = getAllQueryParams();
    expect(params.toString).toBeUndefined();
    expect(params.constructor).toBeUndefined();
    expect(params.hasOwnProperty).toBeUndefined();
  });

  it("returns a key named like a built-in as the URL's string", () => {
    stubSearch("?constructor=a&toString=b");
    const params = getAllQueryParams();
    expect(params.constructor).toBe("a");
    expect(params.toString).toBe("b");
  });

  it("keeps the last value of a repeated key, as it always did", () => {
    stubSearch("?tab=a&tab=b");
    expect(getAllQueryParams().tab).toBe("b");
  });
});
