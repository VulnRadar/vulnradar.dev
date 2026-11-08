import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createLatestRequest } from "@/components/repos/latest-request";

/**
 * Opening scan A and then scan B must never leave B's row showing A's
 * findings, whichever answer arrives last. The suite runs under `node` with
 * no DOM, so the component's loadScanDetail is mirrored here step for step on
 * top of the same helper, with a fetch whose answers the test releases by hand.
 */

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness() {
  const tracker = createLatestRequest();
  const state = {
    scanDetail: null as string | null,
    loading: false,
    selected: null as number | null,
  };
  const pending = new Map<number, ReturnType<typeof deferred<string>>>();
  const signals = new Map<number, AbortSignal>();

  const fakeFetch = (id: number, signal: AbortSignal) => {
    signals.set(id, signal);
    const d = deferred<string>();
    pending.set(id, d);
    return d.promise;
  };

  const open = async (id: number) => {
    state.selected = id;
    state.loading = true;
    const { signal, isCurrent } = tracker.begin();
    try {
      const body = await fakeFetch(id, signal);
      if (!isCurrent()) return;
      state.scanDetail = body;
    } catch {
      if (isCurrent()) state.scanDetail = null;
    } finally {
      if (isCurrent()) state.loading = false;
    }
  };

  return { tracker, state, pending, signals, open };
}

describe("latest-request", () => {
  it("keeps B's findings when A answers after B", async () => {
    const h = harness();
    const a = h.open(1);
    const b = h.open(2);
    h.pending.get(2)!.resolve("findings of B");
    await b;
    expect(h.state.scanDetail).toBe("findings of B");
    expect(h.state.loading).toBe(false);

    h.pending.get(1)!.resolve("findings of A");
    await a;
    expect(h.state.scanDetail).toBe("findings of B");
    expect(h.state.selected).toBe(2);
  });

  it("still loads B when A answers first", async () => {
    const h = harness();
    const a = h.open(1);
    const b = h.open(2);
    h.pending.get(1)!.resolve("findings of A");
    await a;
    expect(h.state.scanDetail).toBeNull();
    expect(h.state.loading).toBe(true);

    h.pending.get(2)!.resolve("findings of B");
    await b;
    expect(h.state.scanDetail).toBe("findings of B");
    expect(h.state.loading).toBe(false);
  });

  it("aborts the earlier request and does not report its failure over B", async () => {
    const h = harness();
    const a = h.open(1);
    const b = h.open(2);
    expect(h.signals.get(1)!.aborted).toBe(true);
    expect(h.signals.get(2)!.aborted).toBe(false);

    h.pending.get(2)!.resolve("findings of B");
    await b;
    // A real fetch rejects with an AbortError once its signal fires.
    h.pending.get(1)!.reject(new DOMException("aborted", "AbortError"));
    await a;
    expect(h.state.scanDetail).toBe("findings of B");
    expect(h.state.loading).toBe(false);
  });

  it("a cancelled request lands nothing and leaves the loading flag to the caller", async () => {
    const h = harness();
    const a = h.open(1);
    h.tracker.cancel();
    h.state.loading = false;
    h.pending.get(1)!.resolve("findings of A");
    await a;
    expect(h.state.scanDetail).toBeNull();
    expect(h.state.loading).toBe(false);
  });

  it("a cancelled request does not end the loading of the open after it", async () => {
    const h = harness();
    const a = h.open(1);
    h.tracker.cancel();
    const b = h.open(2);
    h.pending.get(1)!.resolve("findings of A");
    await a;
    expect(h.state.scanDetail).toBeNull();
    expect(h.state.loading).toBe(true);

    h.pending.get(2)!.resolve("findings of B");
    await b;
    expect(h.state.scanDetail).toBe("findings of B");
    expect(h.state.loading).toBe(false);
  });

  it("only the newest request reports itself current", () => {
    const tracker = createLatestRequest();
    const first = tracker.begin();
    expect(first.isCurrent()).toBe(true);
    const second = tracker.begin();
    expect(first.isCurrent()).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(true);
    tracker.cancel();
    expect(second.isCurrent()).toBe(false);
  });
});

describe("repo detail uses it", () => {
  const src = fs
    .readFileSync(
      path.resolve(__dirname, "../../../components/repos/repo-detail.tsx"),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  // The behaviour above runs on a mirror, so these pin the component to it:
  // the guard has to sit directly after each await, not merely exist.
  const body = (start: string) => {
    const from = src.indexOf(start);
    expect(from).toBeGreaterThanOrEqual(0);
    return src.slice(from, src.indexOf("\n  };\n", from));
  };

  it("guards every state write after the detail fetch", () => {
    const fn = body("const loadScanDetail = async");
    expect(fn).toContain("detailRequest.begin()");
    expect(fn).toMatch(
      /await fetch\(API\.HISTORY_ITEM\(id\), \{ signal \}\);\s*if \(!isCurrent\(\)\) return;/,
    );
    expect(fn).toMatch(/await res\.json\(\);\s*if \(!isCurrent\(\)\) return;/);
    expect(fn).toMatch(
      /catch \{\s*if \(isCurrent\(\)\) setScanDetail\(null\);/,
    );
    expect(fn).toMatch(
      /finally \{\s*if \(isCurrent\(\)\) setDetailLoading\(false\);/,
    );
  });

  it("cancels on repo change, on back, on a fresh scan and on unmount", () => {
    const clears = /detailRequest\.cancel\(\);\s*setDetailLoading\(false\);/;
    expect(
      src.match(/useEffect\(\(\) => \{[\s\S]*?\[repo\.fullName\]\);/)![0],
    ).toMatch(clears);
    expect(body("const backToTimeline = ")).toMatch(clears);
    expect(body("const handleScanClick = async")).toMatch(clears);
    expect(src).toContain(
      "useEffect(() => detailRequest.cancel, [detailRequest])",
    );
  });
});
