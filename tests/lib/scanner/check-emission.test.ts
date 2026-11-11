import { describe, it, expect } from "vitest";
import { getCheckEmission } from "@/lib/scanner/check-emission";
import { detectors as contentDetectors } from "@/lib/scanner/checks/content";
import { detectors as headerDetectors } from "@/lib/scanner/checks/headers";

/**
 * target-blank-no-noopener and the legacy open-redirect are silent stubs until
 * the wave that 301s their /checks pages removes them. They are still in
 * checks-data, so /checks, GET /finding-types and the assistant's knowledge
 * answered "yes, it runs as part of every scan" for ids no scan can report.
 */
describe("retired detectors kept as stubs", () => {
  it.each(["target-blank-no-noopener", "open-redirect"])(
    "%s is documentation only",
    (id) => {
      expect(getCheckEmission(id)).toEqual({
        emitted: false,
        emittedAs: [],
        documentationOnly: true,
      });
    },
  );

  it("is true: neither detector can report anything", () => {
    const headers = new Headers();
    const body =
      '<a href="https://evil.example/" target="_blank">x</a>' +
      '<a href="/go?url=https://evil.example/">y</a>' +
      '<script>location = "https://evil.example/" + location.search</script>';
    const url = "https://example.com/?next=https://evil.example/";
    expect(
      headerDetectors["target-blank-no-noopener"](url, headers, body),
    ).toBeNull();
    expect(contentDetectors["open-redirect"](url, headers, body)).toBeNull();
  });

  it("leaves a live check promising its own id", () => {
    expect(getCheckEmission("directory-listing").emitted).toBe(true);
    expect(getCheckEmission("clickjack-missing").emitted).toBe(true);
  });
});
