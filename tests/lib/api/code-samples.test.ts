import { describe, it, expect } from "vitest";
import {
  CODE_LANGUAGES,
  buildCodeSample,
  type RequestShape,
} from "@/lib/api/code-samples";

const POST: RequestShape = {
  method: "POST",
  url: "https://vulnradar.dev/api/v3/scan",
  body: '{\n  "url": "https://example.com"\n}',
  apiKey: "vr_live_abc",
};

const GET: RequestShape = {
  method: "GET",
  url: "https://vulnradar.dev/api/v3/history/42",
};

describe("buildCodeSample", () => {
  it("has a generator for every advertised language", () => {
    for (const lang of CODE_LANGUAGES) {
      const code = buildCodeSample(lang.id, POST);
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("embeds the pasted key and a compacted single-line body (curl)", () => {
    const code = buildCodeSample("curl", POST);
    expect(code).toContain("curl -X POST 'https://vulnradar.dev/api/v3/scan'");
    expect(code).toContain("Authorization: Bearer vr_live_abc");
    expect(code).toContain("Content-Type: application/json");
    // Compacted to one line, no embedded newline.
    expect(code).toContain(`-d '{"url":"https://example.com"}'`);
  });

  it("falls back to a placeholder when no key is given", () => {
    const code = buildCodeSample("python", { ...POST, apiKey: undefined });
    expect(code).toContain("Bearer YOUR_API_KEY");
    expect(code).not.toContain("vr_live_abc");
  });

  it("omits the body and Content-Type for a GET request", () => {
    for (const id of ["curl", "javascript", "python", "go", "php", "java"]) {
      const code = buildCodeSample(id, GET);
      expect(code).not.toContain("application/json");
      expect(code).not.toContain("example.com");
    }
  });

  it("escapes double quotes for Java's string literal body", () => {
    const code = buildCodeSample("java", POST);
    // The JSON body is embedded in a double-quoted Java string, so its quotes
    // must be backslash-escaped or the snippet would not compile.
    expect(code).toContain('ofString("{\\"url\\":\\"https://example.com\\"}")');
  });

  it("uses the requests convenience method matching the verb (python)", () => {
    expect(buildCodeSample("python", POST)).toContain("requests.post(");
    expect(buildCodeSample("python", GET)).toContain("requests.get(");
  });

  it("unknown language ids fall back to cURL", () => {
    expect(buildCodeSample("cobol", POST)).toContain("curl -X POST");
  });
});
