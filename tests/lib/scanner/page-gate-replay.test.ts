import { describe, it, expect } from "vitest";
import { noPageChecks, runSyncChecks } from "@/lib/scanner/engine";
import { detectUnusablePage } from "@/lib/scanner/response-classifier";
import { REFUSED_RESPONSES } from "./refused-page-fixtures";

const TARGET = "https://example.com/";

/** What every scan path does once it is wired to the gate. */
function scanBehindGate(status: number, headers: Headers, body: string) {
  return detectUnusablePage(status, headers, body) !== null
    ? noPageChecks()
    : runSyncChecks(TARGET, headers, body);
}

const ids = (result: ReturnType<typeof runSyncChecks>) =>
  result.findings.map((finding) => finding.id.split("--")[0]);

describe("a refused page behind the gate", () => {
  it.each(REFUSED_RESPONSES.map((r) => [r.name, r] as const))(
    "%s runs no page checks, and would have been graded without the gate",
    (_name, recorded) => {
      const gated = scanBehindGate(
        recorded.status,
        recorded.headers,
        recorded.body,
      );
      expect(gated.findings).toEqual([]);
      expect(gated.checksRun).toBe(0);

      // Without this the assertion above would pass on a recording that
      // never produced a finding, and prove nothing about the gate.
      const ungated = runSyncChecks(TARGET, recorded.headers, recorded.body);
      expect(ungated.findings.length).toBeGreaterThan(0);
    },
  );

  it("no longer reports a challenge script's eval as the site's", () => {
    const pow = REFUSED_RESPONSES.filter((r) => r.name.startsWith("pow-"));
    expect(pow).toHaveLength(3);
    for (const recorded of pow) {
      expect(
        ids(runSyncChecks(TARGET, recorded.headers, recorded.body)),
      ).toContain("eval-in-client-script");
      expect(
        ids(scanBehindGate(recorded.status, recorded.headers, recorded.body)),
      ).not.toContain("eval-in-client-script");
    }
  });
});

describe("a real page behind the gate", () => {
  it("still reports the headers a plain 200 is missing", () => {
    const found = ids(
      scanBehindGate(
        200,
        new Headers({ "content-type": "text/html" }),
        "<!doctype html><html><head><title>Home</title></head><body><p>Hello</p></body></html>",
      ),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "hsts-missing",
        "csp-missing",
        "clickjack-missing",
        "xcto-missing",
      ]),
    );
  });

  it("still grades a 404 the site served", () => {
    const found = ids(
      scanBehindGate(
        404,
        new Headers({ "content-type": "text/html", server: "nginx/1.18.0" }),
        "<html><head><title>404 Not Found</title></head><body><center>nginx/1.18.0</center></body></html>",
      ),
    );
    expect(found).toContain("nginx-version-404-disclosure");
  });
});
