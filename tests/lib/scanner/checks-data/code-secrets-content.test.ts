/**
 * The most searched secret and dotfile pages were a single line each, and the
 * advice that was there could hurt: docker login -p puts the token in process
 * listings, and an nginx-only deny rule is no use on Apache or Caddy. Severities
 * and wording here follow what the detectors can actually see.
 */

import { describe, expect, it } from "vitest";

import { type CheckPage, loadCheckPages, pageProseWords } from "./_page-prose";

const pages = loadCheckPages();
const page = (id: string): CheckPage => {
  const found = pages.find((p) => p.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
};
const prose = (p: CheckPage) =>
  [p.description, p.riskImpact, p.explanation, ...p.fixSteps].join("\n");
const OWNED = new Set(["code.json", "secrets-extended.json", "content.json"]);
const owned = pages.filter((p) => OWNED.has(p.file));

describe("rewritten critical and high pages", () => {
  it.each([
    "aws-credentials-exposed",
    "private-key-exposed",
    "github-token-exposed",
    "docker-hub-token-exposed",
    "git-directory-exposed",
    "phpinfo-exposed",
    "spring-boot-actuator",
    "directory-listing",
    "command-injection",
    "path-traversal-indicators",
  ])("%s explains itself in its own prose", (id) => {
    const p = page(id);
    // Without the fix steps: the what, the how and the confirm are the part
    // these pages were missing.
    expect(pageProseWords({ ...p, fixSteps: [] }), id).toBeGreaterThanOrEqual(
      80,
    );
    expect(p.fixSteps.length, id).toBeGreaterThanOrEqual(2);
  });

  it("no critical or high page repeats a fix step as its risk", () => {
    const repeated = owned
      .filter((p) => p.severity === "critical" || p.severity === "high")
      .filter((p) => p.riskImpact && p.fixSteps.includes(p.riskImpact))
      .map((p) => p.id);
    expect(repeated).toEqual([]);
  });
});

describe("twin secret pages", () => {
  it.each([
    ["secret-aws-secret-key", "aws-credentials-exposed"],
    ["secret-aws-access-key-id", "aws-credentials-exposed"],
    ["secret-private-key-pem", "private-key-exposed"],
    ["secret-github-pat", "github-token-exposed"],
  ])("%s takes its own angle and points at %s", (twin, survivor) => {
    const explanation = page(twin).explanation ?? "";
    expect(explanation).toContain(`See also ${survivor}`);
    expect(explanation).not.toBe(page(survivor).explanation);
    expect(explanation).not.toBe(page(twin).description);
  });

  it("separates the AWS secret key from the AKIA identifier", () => {
    expect(page("secret-aws-secret-key").explanation).toMatch(/signs requests/);
    expect(page("secret-aws-access-key-id").explanation).toMatch(/identifier/);
  });
});

describe("secret and dotfile instructions", () => {
  it("logs in to a registry on stdin, never with -p", () => {
    expect(
      page("docker-hub-token-exposed")
        .codeExamples.map((e) => e.code)
        .join(),
    ).toContain("--password-stdin");
    const onCommandLine = owned.flatMap((p) =>
      p.codeExamples
        .filter((e) =>
          /docker login[^|\n]*\s-p\s|-p \$CI_JOB_TOKEN/.test(e.code),
        )
        .map(() => p.id),
    );
    expect(onCommandLine).toEqual([]);
  });

  it("describes a PEM header without printing one", () => {
    // The detector has no example stripping, so a literal header in this
    // page's prose reports a critical on the page that explains it.
    expect(prose(page("private-key-exposed"))).not.toMatch(/-----BEGIN/);
  });

  it.each(["git-directory-exposed", "env-file-reference"])(
    "%s denies the path on Nginx, Apache and Caddy and covers static hosts",
    (id) => {
      const p = page(id);
      expect(p.codeExamples.map((e) => e.language)).toEqual([
        "nginx",
        "apache",
        "caddy",
      ]);
      expect(p.fixSteps.join("\n")).toMatch(/static host/i);
      expect(prose(p)).toMatch(/curl -si/);
    },
  );

  it("names the OpenAI and Anthropic key formats", () => {
    const p = page("hardcoded-secrets");
    for (const text of [p.description, p.explanation ?? ""]) {
      expect(text).toContain("OpenAI");
      expect(text).toContain("sk-proj-");
      expect(text).toContain("Anthropic");
      expect(text).toContain("sk-ant-");
    }
  });
});

describe("severity calibration", () => {
  it.each([
    ["source-code-comment", "info"],
    ["cdn-fallback-missing", "info"],
    ["google-api-key-exposed", "low"],
    ["document-write-sink", "medium"],
    ["outdated-js-libs", "medium"],
    ["directory-listing", "medium"],
    ["dangerous-inline-js", "low"],
    ["sensitive-comments", "low"],
  ])("%s is %s", (id, severity) => {
    expect(page(id).severity).toBe(severity);
  });
});

describe("wording matches what the detector can see", () => {
  it("clipboard-access is about reading the clipboard", () => {
    const p = page("clipboard-access");
    expect(p.title).toBe("Page Script Reads the Clipboard");
    expect(p.description).toMatch(/readText/);
    expect(p.description).toMatch(/copy button/i);
  });

  it("base-tag does not call a same-origin base a hijack", () => {
    expect(page("base-tag").riskImpact).toMatch(/same-origin/i);
  });

  it("the iframe sandbox page ties the escape to a same-origin document", () => {
    const p = page("iframe-allow-scripts-allow-same-origin");
    expect(p.description).toMatch(/same origin/i);
    expect(p.explanation).toMatch(/cross-origin/i);
  });

  it("html-injection-patterns stops claiming a reflection it cannot see", () => {
    const p = page("html-injection-patterns");
    expect(p.description).not.toMatch(/reflected/i);
    expect(p.riskImpact).toMatch(/cannot tell/i);
  });

  it("a Google key in a page is a question about restrictions", () => {
    const p = page("google-api-key-exposed");
    expect(p.description).toMatch(/by design/);
    expect(p.fixSteps.join("\n")).toMatch(/referrer/i);
  });

  it("autocomplete-sensitive drops the shared-device caching claim", () => {
    const p = page("autocomplete-sensitive");
    expect(p.riskImpact).not.toMatch(/cache/i);
    expect(p.codeExamples[0].code).toContain("cc-number");
  });

  it("sensitive-meta-tags leaves CSRF meta tags alone", () => {
    const p = page("sensitive-meta-tags");
    expect(p.description).not.toMatch(/csrf/i);
    expect(p.fixSteps.join("\n")).not.toMatch(/HTTP-only cookies/i);
    expect(p.explanation).toMatch(/CSRF token/);
  });
});

describe("copy rules", () => {
  it("has no em dash, en dash or middle dot in the rewritten files", () => {
    const hits = owned
      .filter((p) => /[—–·]/.test(JSON.stringify(p)))
      .map((p) => p.id);
    expect(hits).toEqual([]);
  });
});
