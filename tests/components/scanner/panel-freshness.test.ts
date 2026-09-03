/**
 * The rules behind the re-runnable result panels (DNS records, open ports,
 * page screenshot). These are the parts that decide what a viewer is shown and
 * what happens to what is already on screen, so they are unit-tested here
 * rather than left to the JSX -- the suite has no DOM environment, and these
 * are exactly the parts that do not need one.
 *
 * The load-bearing property is "never blank populated data": every failure mode
 * of a refresh must resolve to `keep`, so the previous capture stays on screen
 * with the reason underneath it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  panelControlsOffered,
  panelFreshness,
  refreshOutcome,
} from "@/components/scanner/panel-freshness";

const NOW = new Date("2026-09-01T12:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

describe("panelFreshness", () => {
  it("reports the age of a capture", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(panelFreshness(at(-3 * 60 * 60 * 1000)).age).toBe("3 hours ago");
  });

  it("has no availability line without a cooldown window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // The screenshot panel passes no cooldown: every capture spends
    // live-browser minutes, so there is no cached answer to wait out and a
    // countdown would be inventing one.
    expect(panelFreshness(at(-60_000)).availability).toBeNull();
  });

  it("counts down to the end of the cooldown window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const oneMinuteAgo = at(-60_000);
    expect(panelFreshness(oneMinuteAgo, 5 * 60 * 1000).availability).toBe(
      "Available to refresh in 4m",
    );
  });

  it("says a refresh is available once the window has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const tenMinutesAgo = at(-10 * 60 * 1000);
    expect(panelFreshness(tenMinutesAgo, 5 * 60 * 1000).availability).toBe(
      "Available to refresh",
    );
  });

  it("returns nulls for a missing timestamp instead of a label", () => {
    expect(panelFreshness(undefined, 5 * 60 * 1000)).toEqual({
      age: null,
      availability: null,
    });
    expect(panelFreshness(null)).toEqual({ age: null, availability: null });
  });

  it("survives an unparseable timestamp rather than throwing", () => {
    // The hand-written copies this replaced built the label as
    // `new Date(new Date(x).getTime() + COOLDOWN).toISOString()`, which throws
    // RangeError on NaN and took the whole panel down with it.
    expect(() => panelFreshness("not-a-date", 5 * 60 * 1000)).not.toThrow();
    expect(panelFreshness("not-a-date", 5 * 60 * 1000)).toEqual({
      age: null,
      availability: null,
    });
  });
});

describe("refreshOutcome - keep what is on screen until replacement arrives", () => {
  const base = {
    responseKey: "portScan",
    failureMessage: "Could not refresh the port sweep.",
  };

  it("replaces only when the response actually carries the capture", () => {
    const fresh = { host: "example.com", open: [] };
    expect(
      refreshOutcome({ ...base, ok: true, body: { portScan: fresh } }),
    ).toEqual({ kind: "replace", data: fresh });
  });

  it("keeps the old data and surfaces the server's message on a failure", () => {
    expect(
      refreshOutcome({
        ...base,
        ok: false,
        body: { error: "Port scanning requires a verified domain." },
      }),
    ).toEqual({
      kind: "keep",
      error: "Port scanning requires a verified domain.",
    });
  });

  it("falls back to the panel's own message when the server sent none", () => {
    expect(refreshOutcome({ ...base, ok: false, body: {} })).toEqual({
      kind: "keep",
      error: base.failureMessage,
    });
    expect(refreshOutcome({ ...base, ok: false, body: null })).toEqual({
      kind: "keep",
      error: base.failureMessage,
    });
  });

  it("keeps the old data when a 200 carries no capture", () => {
    // The inline `else if (data.portScan)` this replaced did nothing at all
    // here: no new data, no error, and a spinner that just stopped.
    expect(refreshOutcome({ ...base, ok: true, body: {} })).toEqual({
      kind: "keep",
      error: base.failureMessage,
    });
    expect(
      refreshOutcome({ ...base, ok: true, body: { portScan: null } }),
    ).toEqual({ kind: "keep", error: base.failureMessage });
  });

  it("never treats a non-object body as data", () => {
    expect(
      refreshOutcome({ ...base, ok: true, body: "<html>502</html>" }),
    ).toEqual({ kind: "keep", error: base.failureMessage });
  });
});

describe("panelControlsOffered - a non-owner gets no run or refresh control", () => {
  it("offers the control for the owner surfaces, which pass a scan id", () => {
    expect(panelControlsOffered(41)).toBe(true);
    expect(panelControlsOffered("scn_abc123")).toBe(true);
  });

  it("withholds it wherever no scan id is passed (/shared, /host, and a non-owner on /history)", () => {
    expect(panelControlsOffered(undefined)).toBe(false);
    expect(panelControlsOffered(null)).toBe(false);
  });

  it("treats an empty or zero id as no owner rather than as a scan", () => {
    expect(panelControlsOffered("")).toBe(false);
    expect(panelControlsOffered(0)).toBe(false);
  });
});
