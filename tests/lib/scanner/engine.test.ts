import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runSyncChecks,
  runSyncChecksYielding,
  getPlannedSyncCategories,
} from "@/lib/scanner/engine";
import { getChecksByCategory } from "@/lib/scanner/registry";

// Lets a single test inject a detector that really throws. The isolation
// guard in lib/scanner/engine.ts is a pair of try/catch blocks, and the only
// test that claimed to cover it just fed a pathological body and asserted
// `.not.toThrow()`: no detector in that run ever threw, so both catch blocks
// could be deleted and the assertion still held. Injecting a thrower is the
// only way to exercise the code the guard is made of.
let injectThrowingCheck = false;
vi.mock("@/lib/scanner/registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/registry")>();
  return {
    ...actual,
    getChecksByCategory: (categories: string[]) => {
      const real = actual.getChecksByCategory(categories as never);
      if (!injectThrowingCheck || !categories.includes("headers")) return real;
      const boom = () => {
        throw new Error("deliberately broken detector");
      };
      boom.checkId = "test-throwing-detector";
      return [boom as unknown as (typeof real)[number], ...real];
    },
  };
});

beforeEach(() => {
  injectThrowingCheck = false;
});

describe("runSyncChecks", () => {
  it("runs both legacy detectors and PageCheck detectors against one response", () => {
    const headers = new Headers({
      "content-type": "text/html",
      "content-security-policy": "script-src 'self' 'unsafe-inline'",
    });
    const body = `<html><body>
      <script src="https://cdn.other.com/a.js"></script>
    </body></html>`;
    const result = runSyncChecks("https://example.com/", headers, body);

    expect(result.checksRun).toBeGreaterThan(0);
    const ids = result.findings.map((f) => f.id.split("--")[0]);
    // A legacy header-based finding (hsts-missing runs on any https:// URL
    // with no HSTS header) and a PageCheck finding (script missing SRI)
    // should both be present in one call.
    expect(ids).toContain("hsts-missing");
    expect(ids.some((id) => id.startsWith("page-"))).toBe(true);
  });

  it("skips PageChecks whose requirements are not met and counts them as skipped", () => {
    const result = runSyncChecks(
      "https://example.com/",
      new Headers({ "content-type": "application/json" }),
      `{"ok":true}`,
    );
    expect(result.checksSkipped).toBeGreaterThan(0);
  });

  it("deduplicates findings that describe the same underlying issue", () => {
    // A page with an SRI-missing third-party script triggers both the
    // legacy sri-missing family and the new page-script-missing-sri check.
    // They share a dedupe group, so the caller should see one finding, not
    // several restating the same thing.
    const headers = new Headers({ "content-type": "text/html" });
    const body = `<html><body><script src="https://cdn.other.com/a.js"></script></body></html>`;
    const result = runSyncChecks("https://example.com/", headers, body);
    const sriFindings = result.findings.filter(
      (f) =>
        f.id.startsWith("sri-missing--") ||
        f.id.startsWith("page-script-missing-sri--") ||
        f.id.startsWith("third-party-script-no-sri--") ||
        f.id.startsWith("supply-chain-sri-external-script--"),
    );
    expect(sriFindings.length).toBe(1);
    expect(sriFindings[0].alsoReportedBy?.length).toBeGreaterThan(0);
  });

  it("filters to the requested categories only", () => {
    const headers = new Headers({ "content-type": "text/html" });
    const body = `<html><body><script src="https://cdn.other.com/a.js"></script></body></html>`;
    const result = runSyncChecks("https://example.com/", headers, body, [
      "cookies",
    ]);
    for (const f of result.findings) {
      expect(f.category).toBe("cookies");
    }
  });

  // Regression guard: even against a body that stresses many regex-based
  // legacy detectors at once, runSyncChecks must return rather than throw.
  // Runs 800+ real detectors against a deliberately pathological body --
  // comfortably fast in isolation (well under 1s), but the default 5s
  // vitest timeout has been observed to flake under a full parallel suite
  // run (267 files, heavy CPU contention across workers) even though no
  // individual detector is slow on its own. 20s gives real headroom
  // without hiding an actual runaway detector, which would take far
  // longer than that even under contention.
  it("survives a pathological body without throwing", () => {
    const headers = new Headers({
      "content-type": "text/html",
      "content-security-policy": "default-src *",
    });
    const body = "<".repeat(5000) + "html".repeat(1000);
    expect(() =>
      runSyncChecks("https://example.com/", headers, body),
    ).not.toThrow();
  }, 20_000);

  it("does not let one throwing check take down the whole scan", () => {
    injectThrowingCheck = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const headers = new Headers({ "content-type": "text/html" });
    const body = `<html><body><script src="https://cdn.other.com/a.js"></script></body></html>`;

    const clean = (() => {
      injectThrowingCheck = false;
      const r = runSyncChecks("https://example.com/", headers, body);
      injectThrowingCheck = true;
      return r;
    })();

    const result = runSyncChecks("https://example.com/", headers, body);

    // The scan completed, the broken detector was accounted for as errored
    // rather than silently counted as a clean pass, and its id reached the
    // log so a broken detector is findable.
    expect(result.checksErrored).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("test-throwing-detector"),
      expect.any(Error),
    );

    // And, the half the old assertion could never see: every finding the
    // other detectors produced is still there. A guard that swallowed the
    // whole category, or returned an empty result, would pass
    // `.not.toThrow()` just as happily.
    expect(result.findings.length).toBe(clean.findings.length);
    expect(result.findings.map((f) => f.id).sort()).toEqual(
      clean.findings.map((f) => f.id).sort(),
    );
    expect(result.findings.some((f) => f.category === "headers")).toBe(true);

    errorSpy.mockRestore();
  }, 20_000);
});

describe("getPlannedSyncCategories", () => {
  it("never includes dns, tls, or email — those have zero synchronous checks", () => {
    const planned = getPlannedSyncCategories();
    expect(planned).not.toContain("dns");
    expect(planned).not.toContain("tls");
    expect(planned).not.toContain("email");
  });

  it("only returns categories from the requested filter", () => {
    const planned = getPlannedSyncCategories(["cookies", "dns"]);
    // "dns" is requested but has no sync work, so it drops out; "cookies"
    // has real checks and survives.
    expect(planned).toEqual(["cookies"]);
  });

  it("matches exactly the categories runSyncChecks reports progress for", () => {
    const seen: string[] = [];
    const headers = new Headers({ "content-type": "text/html" });
    const body = `<html><body><script src="https://cdn.other.com/a.js"></script></body></html>`;

    runSyncChecks(
      "https://example.com/",
      headers,
      body,
      null,
      (category, phase) => {
        if (phase === "start") seen.push(category);
      },
    );

    expect(seen).toEqual(getPlannedSyncCategories());
  });
});

describe("runSyncChecks progress hook", () => {
  it("reports start before done for every category it actually runs, in canonical order", () => {
    const events: Array<{ category: string; phase: string }> = [];
    const headers = new Headers({ "content-type": "text/html" });
    const body = `<html><body><script src="https://cdn.other.com/a.js"></script></body></html>`;

    runSyncChecks(
      "https://example.com/",
      headers,
      body,
      ["cookies", "content"],
      (category, phase) => events.push({ category, phase }),
    );

    expect(events).toEqual([
      { category: "content", phase: "start" },
      { category: "content", phase: "done" },
      { category: "cookies", phase: "start" },
      { category: "cookies", phase: "done" },
    ]);
  });

  // ── Broken-detector accounting (AUDIT-012#obs-01) ───────────────────────
  //
  // A detector that throws reaches no conclusion. Counting it as run made the
  // scan tell the user it had checked something it had not, and swallowing
  // the error with a bare `catch {}` meant a permanently broken check could
  // report "clean" across releases with no signal to anyone.

  it("does not count a throwing detector as run, and logs which one it was", () => {
    // getChecksByCategory memoizes one array per category key and returns
    // that same reference on every call, so patching it in place is what
    // runSyncChecks actually sees. Restored in the finally below.
    const headerChecks = getChecksByCategory(["headers"]);
    const idx = headerChecks.findIndex((c) => c.checkId === "hsts-missing");
    expect(idx).toBeGreaterThanOrEqual(0);
    const original = headerChecks[idx];
    const thrower = Object.assign(
      () => {
        throw new Error("detector exploded");
      },
      { checkId: "hsts-missing" },
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const headers = new Headers({ "content-type": "text/html" });
      const healthy = runSyncChecks(
        "https://example.com/",
        headers,
        "<html></html>",
        ["headers"],
      );

      headerChecks[idx] = thrower;
      const withThrower = runSyncChecks(
        "https://example.com/",
        headers,
        "<html></html>",
        ["headers"],
      );

      expect(healthy.checksErrored).toBe(0);
      expect(withThrower.checksErrored).toBe(1);
      expect(withThrower.checksRun).toBe(healthy.checksRun - 1);
      expect(
        errorSpy.mock.calls.some(([msg]) =>
          String(msg).includes("hsts-missing"),
        ),
      ).toBe(true);
    } finally {
      headerChecks[idx] = original;
      errorSpy.mockRestore();
    }
  });

  it("propagates a throwing hook instead of swallowing it (cancellation contract)", () => {
    const headers = new Headers({ "content-type": "text/html" });
    class Stop extends Error {}
    expect(() =>
      runSyncChecks(
        "https://example.com/",
        headers,
        "<html></html>",
        null,
        () => {
          throw new Stop();
        },
      ),
    ).toThrow(Stop);
  });
});

// AUDIT-011#scan-06: runSyncChecks blocks the event loop for ~1.2s on a 1MB
// body, stalling every other in-flight scan and status poll in the same
// process. runSyncChecksYielding does the identical work while releasing the
// loop as it goes, and is what the scan executors now call.
describe("runSyncChecksYielding", () => {
  const headers = new Headers({
    "content-type": "text/html",
    "content-security-policy": "script-src 'self' 'unsafe-inline'",
  });
  const body = `<html><body>
      <script src="https://cdn.other.com/a.js"></script>
    </body></html>`;

  it("returns exactly what the synchronous driver returns", async () => {
    const sync = runSyncChecks("https://example.com/", headers, body);
    const yielded = await runSyncChecksYielding(
      "https://example.com/",
      headers,
      body,
    );

    expect(yielded.checksRun).toBe(sync.checksRun);
    expect(yielded.checksSkipped).toBe(sync.checksSkipped);
    expect(yielded.checksErrored).toBe(sync.checksErrored);
    expect(yielded.deduped).toBe(sync.deduped);
    expect(yielded.findings.map((f) => f.id).sort()).toEqual(
      sync.findings.map((f) => f.id).sort(),
    );
  });

  it("actually releases the event loop while it runs", async () => {
    // A macrotask queued before the call: if the pass never yielded, this
    // could only run after the whole thing finished.
    let ranDuringPass = false;
    let passDone = false;
    setImmediate(() => {
      ranDuringPass = !passDone;
    });

    const result = runSyncChecksYielding(
      "https://example.com/",
      headers,
      body,
    ).then((r) => {
      passDone = true;
      return r;
    });
    await result;

    expect(ranDuringPass).toBe(true);
  });

  it("reports the same category progress, in the same order", async () => {
    const syncEvents: string[] = [];
    runSyncChecks("https://example.com/", headers, body, null, (c, phase) =>
      syncEvents.push(`${c}:${phase}`),
    );

    const yieldedEvents: string[] = [];
    await runSyncChecksYielding(
      "https://example.com/",
      headers,
      body,
      null,
      (c, phase) => yieldedEvents.push(`${c}:${phase}`),
    );

    expect(yieldedEvents).toEqual(syncEvents);
  });

  it("propagates a throwing hook instead of swallowing it (cancellation contract)", async () => {
    class Stop extends Error {}
    await expect(
      runSyncChecksYielding(
        "https://example.com/",
        headers,
        "<html></html>",
        null,
        () => {
          throw new Stop();
        },
      ),
    ).rejects.toBeInstanceOf(Stop);
  });
});
