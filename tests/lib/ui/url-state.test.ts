import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getQueryParam,
  getQueryParamInt,
  getAllQueryParams,
  setQueryParam,
  setQueryParams,
  removeQueryParam,
  clearQueryParams,
  QUERY_CHANGE_EVENT,
} from "@/lib/ui/url-state";

/**
 * lib/ui/url-state.ts is a "use client" module written to behave safely
 * during SSR (no `window`) and to drive `window.location` / `history` in
 * the browser. vitest.config.ts runs under the "node" environment (no
 * jsdom / @testing-library in this repo yet - see the hook-testing note in
 * this session's report), so there is no real `window.location` /
 * `window.history` to exercise. To cover the browser-side behavior, this
 * suite stubs a minimal fake `window` at the same global the module itself
 * reads through, rather than mocking anything inside url-state.ts.
 */

function makeFakeWindow(pathname = "/test", search = "") {
  const target = new EventTarget();
  const location = { pathname, search, hash: "" };

  function applyHref(href: string) {
    const qIndex = href.indexOf("?");
    if (qIndex === -1) {
      location.pathname = href || location.pathname;
      location.search = "";
    } else {
      location.pathname = href.slice(0, qIndex) || location.pathname;
      location.search = href.slice(qIndex);
    }
  }

  return {
    location,
    history: {
      pushState: (_state: unknown, _title: string, url: string) =>
        applyHref(url),
      replaceState: (_state: unknown, _title: string, url: string) =>
        applyHref(url),
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
}

describe("without a window (SSR)", () => {
  it("getQueryParam returns null", () => {
    expect(getQueryParam("foo")).toBeNull();
  });

  it("getQueryParamInt returns null", () => {
    expect(getQueryParamInt("foo")).toBeNull();
  });

  it("getAllQueryParams returns an empty object", () => {
    expect(getAllQueryParams()).toEqual({});
  });

  it("setQueryParam / clearQueryParams are no-ops that do not throw", () => {
    expect(() => setQueryParam("foo", "bar")).not.toThrow();
    expect(() => clearQueryParams()).not.toThrow();
  });
});

describe("in a browser-like environment", () => {
  beforeEach(() => {
    vi.stubGlobal("window", makeFakeWindow());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a string param through setQueryParam / getQueryParam", () => {
    setQueryParam("foo", "bar");
    expect(getQueryParam("foo")).toBe("bar");
  });

  it("round-trips an int param through setQueryParam / getQueryParamInt", () => {
    setQueryParam("page", "3");
    expect(getQueryParamInt("page")).toBe(3);
  });

  it("removes a param by setting it to null", () => {
    setQueryParam("foo", "bar");
    setQueryParam("foo", null);
    expect(getQueryParam("foo")).toBeNull();
  });

  it("removes a param by setting it to an empty string", () => {
    setQueryParam("foo", "bar");
    setQueryParam("foo", "");
    expect(getQueryParam("foo")).toBeNull();
  });

  it("removeQueryParam removes a single key without touching others", () => {
    setQueryParams({ a: "1", b: "2" });
    removeQueryParam("a");
    expect(getAllQueryParams()).toEqual({ b: "2" });
  });

  it("setQueryParams writes multiple keys in one history update", () => {
    setQueryParams({ a: "1", b: "2", c: "3" });
    expect(getAllQueryParams()).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("clearQueryParams removes every param", () => {
    setQueryParams({ a: "1", b: "2" });
    clearQueryParams();
    expect(getAllQueryParams()).toEqual({});
  });

  it("preserves the pathname across a query-only update", () => {
    setQueryParam("foo", "bar");
    expect(
      (window as unknown as { location: { pathname: string } }).location
        .pathname,
    ).toBe("/test");
  });

  it("dispatches a vr:query-change event with the key and value", () => {
    const handler = vi.fn();
    window.addEventListener(QUERY_CHANGE_EVENT, handler);

    setQueryParam("foo", "bar");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent<{
      key: string;
      value: string | null;
    }>;
    expect(event.detail).toEqual({ key: "foo", value: "bar" });
  });

  it("replace: true uses replaceState instead of pushState", () => {
    const fakeWindow = makeFakeWindow();
    const pushSpy = vi.spyOn(fakeWindow.history, "pushState");
    const replaceSpy = vi.spyOn(fakeWindow.history, "replaceState");
    vi.stubGlobal("window", fakeWindow);

    setQueryParam("foo", "bar", { replace: true });

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("dispatches a query-change event for every cleared key (regression test: clearQueryParams used to read window.location.search AFTER history.pushState already cleared it, see lib/ui/url-state.ts)", () => {
    // clearQueryParams now captures which keys are present BEFORE calling
    // window.history[method](...), since that call (per the History API)
    // synchronously updates window.location to the new, query-string-less
    // URL. Reading window.location.search after that point would always
    // see it already empty, so no query-change event would ever fire for
    // a cleared key - a useQueryParam consumer relying solely on that
    // event to notice a clearQueryParams() call would never update.
    setQueryParams({ a: "1", b: "2" });
    const handler = vi.fn();
    window.addEventListener(QUERY_CHANGE_EVENT, handler);

    clearQueryParams();

    expect(handler).toHaveBeenCalledTimes(2);
    const details = handler.mock.calls
      .map(
        (call) =>
          (call[0] as CustomEvent<{ key: string; value: string | null }>)
            .detail,
      )
      .sort((a, b) => a.key.localeCompare(b.key));
    expect(details).toEqual([
      { key: "a", value: null },
      { key: "b", value: null },
    ]);
    expect(getAllQueryParams()).toEqual({});
  });

  describe("malformed input handling", () => {
    it("getQueryParam returns null for a missing key", () => {
      expect(getQueryParam("missing")).toBeNull();
    });

    it("getQueryParamInt returns null for a non-numeric value", () => {
      setQueryParam("n", "not-a-number");
      expect(getQueryParamInt("n")).toBeNull();
    });

    it("getQueryParamInt parses the leading digits of a mixed value (documents current parseInt-based behavior)", () => {
      setQueryParam("n", "12abc");
      expect(getQueryParamInt("n")).toBe(12);
    });

    it("getQueryParamInt returns null for an empty value", () => {
      setQueryParam("n", "");
      expect(getQueryParamInt("n")).toBeNull();
    });

    it("getQueryParamInt returns null for 'Infinity' (parseInt, not Number)", () => {
      setQueryParam("n", "Infinity");
      expect(getQueryParamInt("n")).toBeNull();
    });

    it("getAllQueryParams handles a value-less key", () => {
      const fakeWindow = makeFakeWindow("/test", "?a=&b=2");
      vi.stubGlobal("window", fakeWindow);
      expect(getAllQueryParams()).toEqual({ a: "", b: "2" });
    });
  });
});
