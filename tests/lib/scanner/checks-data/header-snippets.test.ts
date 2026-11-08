/**
 * The most searched header pages answer "how do I set this on my server", so
 * a page with only Next.js and Nginx cannot be pasted by anyone on Apache or
 * IIS. The HSTS and CSP pages also led with the fix most likely to hurt: a
 * two-year preload policy on first try, and a static script-src that blocks
 * every inline script a server-rendered framework emits.
 */

import { describe, expect, it } from "vitest";
import headers from "@/lib/scanner/checks-data/headers.json";

interface CheckDef {
  id: string;
  type: string;
  title: string;
  severity: string;
  description: string;
  evidence: string;
  riskImpact?: string;
  explanation?: string;
  fixSteps: string[];
  codeExamples: { label: string; language: string; code: string }[];
}

const all = headers as CheckDef[];
const byId = (id: string) => {
  const check = all.find((c) => c.id === id);
  if (!check) throw new Error(`no check ${id}`);
  return check;
};

const SNIPPET_SET = [
  "hsts-missing",
  "strict-transport-security-include-subdomains",
  "hsts-no-preload",
  "csp-missing",
  "clickjack-missing",
  "xcto-missing",
  "referrer-policy-unsafe",
  "referrer-policy-no-referrer-strict-origin-when-cross-origin",
  "coop-missing",
  "coep-missing",
  "cross-origin-resource-policy-report-only-missing",
  "permissions-policy-missing",
  "x-powered-by-exposed",
  "server-header-disclosure",
  "server-version-detailed",
];

const APP_FRAMEWORK =
  /Next[.]js|Express|Hono|Elysia|ASP[.]NET|Uvicorn|Django|Rails|Laravel/;

const labels = (c: CheckDef) => c.codeExamples.map((e) => e.label);
const example = (c: CheckDef, pattern: RegExp) => {
  const found = c.codeExamples.find((e) => pattern.test(e.label));
  if (!found) throw new Error(`${c.id} has no ${pattern} example`);
  return found;
};

describe("server snippets on the most searched header pages", () => {
  for (const id of SNIPPET_SET) {
    describe(id, () => {
      const check = byId(id);

      it.each([
        ["Nginx", /Nginx/],
        ["Apache", /Apache/],
        ["Caddy", /Caddy/],
        ["IIS", /IIS/],
        ["Cloudflare", /Cloudflare/],
      ])("has a %s snippet", (_name, pattern) => {
        expect(labels(check).some((l) => pattern.test(l))).toBe(true);
      });

      it("has an app framework snippet", () => {
        expect(labels(check).some((l) => APP_FRAMEWORK.test(l))).toBe(true);
      });

      it("gives IIS a complete web.config", () => {
        const { code, language } = example(check, /IIS/);
        expect(language).toBe("xml");
        expect(code).toContain("<configuration>");
        expect(code).toContain("</configuration>");
        expect(code).toContain("<system.webServer>");
      });

      it("has no duplicate snippet labels", () => {
        expect(new Set(labels(check)).size).toBe(labels(check).length);
      });
    });
  }

  it("uses the Apache and IIS syntax for the headers it removes", () => {
    const poweredBy = byId("x-powered-by-exposed");
    expect(example(poweredBy, /Apache/).code).toContain(
      "Header always unset X-Powered-By",
    );
    expect(example(poweredBy, /IIS/).code).toContain(
      '<remove name="X-Powered-By" />',
    );
    expect(example(poweredBy, /Caddy/).code).toContain("header -X-Powered-By");
  });

  it("does not offer a custom server_tokens string, which open source Nginx rejects", () => {
    for (const id of ["server-header-disclosure", "server-version-detailed"]) {
      expect(example(byId(id), /Nginx/).code).not.toMatch(/server_tokens "/);
    }
  });

  it("does not blame poweredByHeader for the Server header", () => {
    expect(byId("server-header-disclosure").fixSteps.join(" ")).not.toContain(
      "poweredByHeader",
    );
  });

  it("does not promise a Cloudflare rule can rewrite Server", () => {
    expect(
      example(byId("server-header-disclosure"), /Cloudflare/).code,
    ).toMatch(/cannot/);
  });
});

describe("hsts-missing starts small", () => {
  const check = byId("hsts-missing");

  it("leads every snippet with the five minute policy", () => {
    for (const { label, code } of check.codeExamples) {
      expect(code.match(/max-age=([0-9]+)/)?.[1], label).toBe("300");
    }
  });

  it("orders the fix steps short before long", () => {
    const text = check.fixSteps.join("\n");
    expect(text.indexOf("max-age=300")).toBeGreaterThan(-1);
    expect(text.indexOf("max-age=300")).toBeLessThan(
      text.indexOf("max-age=31536000"),
    );
  });

  it("names the one year target in every snippet", () => {
    for (const { label, code } of check.codeExamples) {
      expect(code, label).toMatch(/31536000|12 months/);
    }
  });

  it("presents preload as optional", () => {
    expect(check.fixSteps.join(" ")).toMatch(/preload is optional/i);
  });
});

describe("csp-missing fits the stack", () => {
  const check = byId("csp-missing");

  it("leads with a per-request nonce in middleware", () => {
    const first = check.codeExamples[0];
    expect(first.label).toMatch(/Next[.]js/);
    expect(first.label).toMatch(/nonce/i);
    expect(first.code).toContain("middleware");
    expect(first.code).toContain("'strict-dynamic'");
    expect(first.code).toContain("'nonce-${nonce}'");
    expect(first.code).toContain("getRandomValues");
  });

  it("no longer offers a static script-src to Next.js", () => {
    const nextExamples = check.codeExamples.filter((e) =>
      /Next[.]js/.test(e.label),
    );
    expect(nextExamples).toHaveLength(1);
    expect(nextExamples[0].code).not.toContain("async headers()");
  });

  it("keeps 'self' for static stacks and says that is what it is for", () => {
    for (const pattern of [/Nginx/, /Apache/, /Caddy/]) {
      const { code } = example(check, pattern);
      expect(code).toContain("script-src 'self'");
      expect(code).toMatch(/static site/i);
    }
  });

  it("tells the reader to choose by how the page is built", () => {
    expect(check.fixSteps[0]).toMatch(/nonce/);
    expect(check.fixSteps[0]).toMatch(/static/);
  });
});

describe("HSTS preload is no longer the goal (owner decision T6)", () => {
  const check = byId("hsts-no-preload");

  it("keeps the id and carries the new title", () => {
    expect(check.title).toBe(
      "HSTS max-age is short or the preload token is unusable",
    );
  });

  it("opens with max-age, not a preload submission", () => {
    expect(check.fixSteps[0]).toMatch(/max-age/);
    expect(check.fixSteps[0]).not.toMatch(/submit/i);
  });

  it("drops the instruction to submit to the list", () => {
    expect(check.fixSteps.join(" ")).not.toMatch(/submit to the preload list/i);
  });

  it("says a missing token is not reported", () => {
    expect(check.description).toMatch(/not reported/);
  });

  it.each(["hsts-no-preload", "strict-transport-security-include-subdomains"])(
    "%s does not ship a preload token in its snippets",
    (id) => {
      for (const { label, code } of byId(id).codeExamples) {
        expect(code, label).not.toMatch(/includeSubDomains; preload/);
      }
    },
  );
});

describe("wording from the engine research", () => {
  it("x-frame-options-invalid no longer lists ALLOW-FROM as valid", () => {
    const check = byId("x-frame-options-invalid");
    expect(check.description).toMatch(/ALLOW-FROM/);
    expect(check.description).toMatch(/obsolete/);
    expect(check.description).toMatch(/duplicate/);
    expect(check.explanation).not.toMatch(/SAMEORIGIN, ALLOW-FROM are valid/);
  });

  it("csp-report-only says it blocks nothing", () => {
    const check = byId("csp-report-only");
    expect(check.description).toContain("Content-Security-Policy-Report-Only");
    expect(check.evidence).toMatch(/blocks nothing/);
    expect(check.explanation).not.toMatch(/zero protection/);
  });

  it("target-blank-no-noopener gives the three browser versions", () => {
    const check = byId("target-blank-no-noopener");
    for (const version of ["Chrome 88", "Firefox 79", "Safari 12.1"]) {
      expect(check.description).toContain(version);
    }
    expect(check.explanation).not.toMatch(/classic reverse-tabnabbing/);
    expect(check.fixSteps[0]).not.toMatch(/to all <a> tags/);
  });
});

describe("calibration", () => {
  it.each([
    ["hsts-missing", "medium"],
    ["csp-missing", "medium"],
    ["csp-unsafe-eval-detected", "medium"],
    ["strict-transport-security-include-subdomains", "low"],
    ["csp-form-action-missing", "low"],
    ["csp-base-uri-missing", "low"],
    ["csp-no-upgrade-insecure", "info"],
    ["cache-control-no-store-missing", "low"],
    ["cors-wildcard", "low"],
  ])("%s is %s", (id, severity) => {
    expect(byId(id).severity).toBe(severity);
  });

  it.each(["sri-missing", "sri-stylesheet-missing", "autocomplete-username"])(
    "%s is typed as the body regex it is",
    (id) => {
      expect(byId(id).type).toBe("body-pattern");
    },
  );

  it("did not retitle the checks whose severity moved", () => {
    expect(byId("hsts-missing").title).toBe(
      "Missing HTTP Strict Transport Security (HSTS)",
    );
    expect(byId("csp-missing").title).toBe(
      "Missing Content Security Policy (CSP)",
    );
    expect(byId("csp-unsafe-eval-detected").title).toBe(
      "CSP Allows unsafe-eval",
    );
  });
});
