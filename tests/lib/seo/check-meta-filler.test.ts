import { describe, it, expect } from "vitest";
import { isGeneratedFiller } from "@/lib/seo/check-meta";

describe("isGeneratedFiller", () => {
  it("matches the generated sentence the code category shipped", () => {
    expect(
      isGeneratedFiller(
        "The `code-cmdi-exec` check verifies that the server does not expose the `cmdi-exec` weakness in the code category. The detection runs against the response headers, body, or auxiliary probes (DNS, TLS, async fetch) as appropriate.",
      ),
    ).toBe(true);
  });

  it("leaves a real explanation alone", () => {
    expect(
      isGeneratedFiller(
        "The check parses the policy and confirms the directive is present.",
      ),
    ).toBe(false);
    expect(isGeneratedFiller("")).toBe(false);
  });
});
