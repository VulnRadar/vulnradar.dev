import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildScanFormQuery,
  type ScanFormQueryState,
} from "@/components/scanner/scan-form-query";
import { setQueryParams, QUERY_CHANGE_EVENT } from "@/lib/ui/url-state";

const FAMILIES = ["headers", "cookies", "tls"];

function state(over: Partial<ScanFormQueryState> = {}): ScanFormQueryState {
  return {
    mode: "quick",
    familyIds: FAMILIES,
    enabledFamilies: new Set(FAMILIES),
    selectedActiveProbes: new Set(),
    captureScreenshot: false,
    portScan: false,
    ...over,
  };
}

describe("buildScanFormQuery", () => {
  it("returns every key the form owns in one object, defaults as null", () => {
    expect(buildScanFormQuery(state())).toEqual({
      mode: "quick",
      active_probes: null,
      screenshot: null,
      port_scan: null,
      family_headers: null,
      family_cookies: null,
      family_tls: null,
    });
  });

  it("writes only the families that are switched off, and the switches that are on", () => {
    const q = buildScanFormQuery(
      state({
        mode: "deep",
        enabledFamilies: new Set(["headers", "tls"]),
        captureScreenshot: true,
        portScan: true,
      }),
    );
    expect(q.mode).toBe("deep");
    expect(q.family_cookies).toBe("0");
    expect(q.family_headers).toBeNull();
    expect(q.screenshot).toBe("1");
    expect(q.port_scan).toBe("1");
  });
});

describe("mirroring the form into the URL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeWindow() {
    const target = new EventTarget();
    const location = { pathname: "/dashboard", search: "", hash: "" };
    const apply = (_s: unknown, _t: string, href: string) => {
      const i = href.indexOf("?");
      location.search = i === -1 ? "" : href.slice(i);
    };
    const history = { pushState: apply, replaceState: apply };
    const replace = vi.spyOn(history, "replaceState");
    vi.stubGlobal("window", {
      location,
      history,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
    return replace;
  }

  it("calls replaceState once on mount, once per toggle and zero times when nothing changed", () => {
    const replace = fakeWindow();
    const mirror = (s: ScanFormQueryState) =>
      setQueryParams(buildScanFormQuery(s), { replace: true });

    mirror(state());
    expect(replace).toHaveBeenCalledTimes(1);

    mirror(state());
    expect(replace).toHaveBeenCalledTimes(1);

    mirror(state({ enabledFamilies: new Set(["headers", "tls"]) }));
    expect(replace).toHaveBeenCalledTimes(2);

    mirror(state({ captureScreenshot: true }));
    expect(replace).toHaveBeenCalledTimes(3);
  });

  it("emits one query-change event per key that moved", () => {
    fakeWindow();
    const handler = vi.fn();
    window.addEventListener(QUERY_CHANGE_EVENT, handler);

    setQueryParams(buildScanFormQuery(state()), { replace: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail.key).toBe("mode");
  });
});

describe("scan-form.tsx", () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, "../../../components/scanner/scan-form.tsx"),
    "utf8",
  );

  it("does not write the URL one param at a time", () => {
    expect(SRC).not.toMatch(/\bsetQueryParam\(/);
    expect(SRC.match(/setQueryParams\(/g)).toHaveLength(1);
    expect(SRC).toContain("buildScanFormQuery(");
  });
});
