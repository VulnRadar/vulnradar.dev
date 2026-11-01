import { describe, it, expect, afterEach, vi } from "vitest";
import {
  setQueryParam,
  setQueryParams,
  removeQueryParam,
  clearQueryParams,
  QUERY_CHANGE_EVENT,
} from "@/lib/ui/url-state";

/**
 * How many times url-state touches history. Safari throws a SecurityError
 * after 100 pushState/replaceState calls in 30 seconds, so the count matters
 * as much as the resulting URL. Same fake-window approach as url-state.test.ts
 * (the unit tier runs under node with no DOM).
 */

function spiedWindow(pathname = "/dashboard", search = "") {
  const target = new EventTarget();
  const location = { pathname, search, hash: "" };
  const apply = (_state: unknown, _title: string, href: string) => {
    const i = href.indexOf("?");
    location.search = i === -1 ? "" : href.slice(i);
  };
  const history = { pushState: apply, replaceState: apply };
  const replace = vi.spyOn(history, "replaceState");
  const push = vi.spyOn(history, "pushState");
  vi.stubGlobal("window", {
    location,
    history,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
  return { history, replace, push };
}

describe("history writes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("setQueryParam with the existing value writes nothing and emits nothing", () => {
    const { replace, push } = spiedWindow("/dashboard", "?mode=quick");
    const handler = vi.fn();
    window.addEventListener(QUERY_CHANGE_EVENT, handler);

    setQueryParam("mode", "quick", { replace: true });
    setQueryParam("mode", "quick");

    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("removing a param that is not there writes nothing", () => {
    const { replace, push } = spiedWindow("/dashboard", "?mode=quick");
    removeQueryParam("screenshot", { replace: true });
    setQueryParam("screenshot", "");
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("setQueryParams makes one write for any number of keys, and none when nothing moves", () => {
    const { replace } = spiedWindow("/dashboard");
    const values = { mode: "deep", family_cookies: "0", family_headers: null };

    setQueryParams(values, { replace: true });
    expect(replace).toHaveBeenCalledTimes(1);

    setQueryParams(values, { replace: true });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("emits one event per key that changed and none for the keys that did not", () => {
    spiedWindow("/dashboard", "?mode=quick");
    const handler = vi.fn();
    window.addEventListener(QUERY_CHANGE_EVENT, handler);

    setQueryParams(
      { mode: "quick", screenshot: "1", port_scan: null },
      { replace: true },
    );

    const details = handler.mock.calls.map(
      (call) => (call[0] as CustomEvent).detail,
    );
    expect(details).toEqual([{ key: "screenshot", value: "1" }]);
  });

  it("does not treat a different spelling of the same params as a change", () => {
    const { replace } = spiedWindow("/dashboard", "?q=a%20b");
    setQueryParam("q", "a b", { replace: true });
    expect(replace).not.toHaveBeenCalled();
  });

  it("clearQueryParams on a URL with no query writes nothing", () => {
    const { replace, push } = spiedWindow("/dashboard");
    clearQueryParams();
    clearQueryParams({ replace: true });
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("degrades to a skipped update when the browser refuses the write (Safari SecurityError)", () => {
    const { history } = spiedWindow("/dashboard", "?a=1");
    history.replaceState = () => {
      throw new DOMException("too many calls", "SecurityError");
    };
    const handler = vi.fn();
    window.addEventListener(QUERY_CHANGE_EVENT, handler);

    expect(() =>
      setQueryParams({ mode: "deep" }, { replace: true }),
    ).not.toThrow();
    expect(() => clearQueryParams({ replace: true })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
