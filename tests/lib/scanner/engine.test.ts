import { describe, it, expect } from "vitest";
import { runSyncChecks, getPlannedSyncCategories } from "@/lib/scanner/engine";

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

  it(
    "does not let one throwing check take down the whole scan",
    () => {
      // Regression guard: even against a body that stresses many regex-based
      // legacy detectors at once, runSyncChecks must return rather than throw.
      const headers = new Headers({
        "content-type": "text/html",
        "content-security-policy": "default-src *",
      });
      const body = "<".repeat(5000) + "html".repeat(1000);
      expect(() =>
        runSyncChecks("https://example.com/", headers, body),
      ).not.toThrow();
    },
    // Runs 800+ real detectors against a deliberately pathological body.
    // Comfortably fast in isolation (well under 1s), but the default 5s
    // vitest timeout has been observed to flake under a full parallel
    // suite run (267 files, heavy CPU contention across workers) even
    // though no individual detector is slow -- see the per-detector timing
    // sweep in this session's investigation. 20s gives real headroom
    // without hiding an actual runaway detector, which would take far
    // longer than that even under contention.
    20_000,
  );
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
