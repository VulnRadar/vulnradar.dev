import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_API_HOST,
  MAX_DESCRIPTION_LENGTH,
  normalizeApiHost,
  resolveManifest,
} from "../../extension/scripts/manifest.mjs";

/**
 * The extension ships two manifests from one codebase, and a store reviewer, a
 * browser and a user's permission prompt each read them differently. These
 * checks hold the properties that have gone wrong or would be expensive to get
 * wrong: the two targets drifting apart, a placeholder surviving into a zip, a
 * content security policy the browser refuses to load, and the README's
 * permission table (the one document a reader checks against the manifest)
 * saying something the manifest does not.
 */

const EXT = resolve(__dirname, "../../extension");
const read = (path: string) => readFileSync(resolve(EXT, path), "utf8");
const readJson = (path: string) =>
  JSON.parse(read(path)) as Record<string, unknown> & {
    description: string;
    permissions: string[];
    host_permissions: string[];
    content_scripts: { matches: string[]; all_frames: boolean }[];
    content_security_policy: { extension_pages: string };
    commands: {
      _execute_action: { suggested_key: Record<string, string> };
    };
    minimum_chrome_version?: string;
    browser_specific_settings?: {
      gecko: {
        id: string;
        strict_min_version: string;
        data_collection_permissions: { required: string[] };
      };
      gecko_android: { strict_min_version: string };
    };
    homepage_url: string;
    version: string;
  };

const chromeTpl = readJson("manifest/chrome.json");
const firefoxTpl = readJson("manifest/firefox.json");
const pkg = JSON.parse(read("package.json")) as { version: string };

const CUSTOM_HOST = "https://scan.example.org:8443";

function resolved(target: "chrome" | "firefox", apiHost?: string) {
  const tpl = target === "chrome" ? chromeTpl : firefoxTpl;
  return resolveManifest(tpl, {
    version: pkg.version,
    apiHost,
  }) as ReturnType<typeof readJson>;
}

function directives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

describe("Chrome and Firefox manifests stay in step", () => {
  const IGNORED_BY_DESIGN = new Set([
    // Chrome runs a service worker, Firefox a background script.
    "background",
    // Firefox only.
    "browser_specific_settings",
    // Chrome only.
    "minimum_chrome_version",
    // The macOS binding is a Chrome concept.
    "commands",
  ]);

  it("share every key that is not target-specific, with equal values", () => {
    const keys = new Set([
      ...Object.keys(chromeTpl),
      ...Object.keys(firefoxTpl),
    ]);
    for (const key of keys) {
      if (IGNORED_BY_DESIGN.has(key)) continue;
      expect(firefoxTpl[key], key).toEqual(chromeTpl[key]);
    }
  });

  it("requests exactly the same permissions", () => {
    expect([...chromeTpl.permissions].sort()).toEqual(
      [...firefoxTpl.permissions].sort(),
    );
    expect(chromeTpl.host_permissions).toEqual(firefoxTpl.host_permissions);
  });

  it("binds the same default shortcut", () => {
    const c = chromeTpl.commands._execute_action.suggested_key;
    const f = firefoxTpl.commands._execute_action.suggested_key;
    expect(f.default).toBe(c.default);
    expect(c.default).toBe("Ctrl+Shift+U");
  });

  it("keeps the gecko block on Firefox and off Chrome", () => {
    expect(chromeTpl.browser_specific_settings).toBeUndefined();
    expect(firefoxTpl.minimum_chrome_version).toBeUndefined();
    const gecko = firefoxTpl.browser_specific_settings!;
    expect(gecko.gecko.id).toBe("support@vulnradar.dev");
    expect(gecko.gecko.strict_min_version).toBe("140.0");
    expect(gecko.gecko_android.strict_min_version).toBe("142.0");
    // Declared because the extension reads the address of every tab it runs in.
    expect(gecko.gecko.data_collection_permissions.required).toContain(
      "browsingActivity",
    );
  });

  it("requires Chrome 120, the first with a 30 second alarm period", () => {
    expect(chromeTpl.minimum_chrome_version).toBe("120");
  });
});

describe("store posture", () => {
  it("injects the content script into http and https pages only", () => {
    for (const tpl of [chromeTpl, firefoxTpl]) {
      expect(tpl.content_scripts).toHaveLength(1);
      expect(tpl.content_scripts[0]!.matches).toEqual([
        "http://*/*",
        "https://*/*",
      ]);
      expect(tpl.content_scripts[0]!.all_frames).toBe(false);
    }
    expect(JSON.stringify(chromeTpl)).not.toContain("<all_urls>");
    expect(JSON.stringify(firefoxTpl)).not.toContain("<all_urls>");
  });

  it("describes what is checked, honestly, inside the stores' length limit", () => {
    for (const target of ["chrome", "firefox"] as const) {
      const { description } = resolved(target);
      expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      expect(description).toMatch(/security headers/i);
      expect(description).toMatch(/API key/i);
      // The old one-liner promised "one-click" scanning of "any website".
      expect(description).not.toMatch(/one-click/i);
    }
  });

  it("points the homepage at the extension docs on the configured host", () => {
    expect(resolved("chrome").homepage_url).toBe(
      `${DEFAULT_API_HOST}/docs/extension`,
    );
    expect(resolved("firefox", CUSTOM_HOST).homepage_url).toBe(
      `${CUSTOM_HOST}/docs/extension`,
    );
  });
});

describe("content security policy", () => {
  for (const target of ["chrome", "firefox"] as const) {
    for (const host of [undefined, CUSTOM_HOST]) {
      it(`${target}, ${host ?? "default host"}: restates script-src and object-src and pins connect-src`, () => {
        const csp = resolved(target, host).content_security_policy
          .extension_pages;
        const d = directives(csp);
        // Both are required for a Manifest V3 policy to load at all: a policy
        // that names any directive but leaves these out replaces the default
        // and the browser rejects the manifest.
        expect(d.get("script-src")).toEqual(["'self'"]);
        expect(d.get("object-src")).toEqual(["'self'"]);
        // The only origin the pages and the worker may talk to is the API.
        expect(d.get("connect-src")).toEqual([host ?? DEFAULT_API_HOST]);
        expect([...d.keys()].sort()).toEqual([
          "connect-src",
          "object-src",
          "script-src",
        ]);
      });
    }
  }

  it("allows nothing that would let the pages run remote or inline script", () => {
    const csp = resolved("chrome", CUSTOM_HOST).content_security_policy
      .extension_pages;
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:\/\/[^;]*script/);
  });
});

describe("resolving a manifest", () => {
  it("fills the version and the host and leaves no placeholder behind", () => {
    for (const target of ["chrome", "firefox"] as const) {
      for (const host of [undefined, CUSTOM_HOST]) {
        const text = JSON.stringify(resolved(target, host));
        expect(text, `${target} ${host ?? "default"}`).not.toMatch(
          /__[A-Z_]+__/,
        );
        expect(text).toContain(`"version":"${pkg.version}"`);
        expect(text).toContain(`${host ?? DEFAULT_API_HOST}/*`);
      }
    }
  });

  it("fails the build on a placeholder it did not fill", () => {
    expect(() =>
      resolveManifest(
        { description: "x", version: "__VERSION__", extra: "__UNKNOWN__" },
        { version: "1.0.0", apiHost: undefined },
      ),
    ).toThrow(/__UNKNOWN__/);
  });

  it("fails the build on a description over the stores' limit", () => {
    expect(() =>
      resolveManifest(
        { description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1) },
        { version: "1.0.0", apiHost: undefined },
      ),
    ).toThrow(/description/);
  });

  it("normalises the API host and rejects anything that is not an origin", () => {
    expect(normalizeApiHost(undefined)).toBe(DEFAULT_API_HOST);
    expect(normalizeApiHost("")).toBe(DEFAULT_API_HOST);
    expect(normalizeApiHost("https://scan.example.org/")).toBe(
      "https://scan.example.org",
    );
    expect(normalizeApiHost("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    for (const bad of [
      "ftp://example.org",
      "example.org",
      "https://example.org/app",
      "https://example.org?x=1",
      "https://user:pw@example.org",
      "javascript:alert(1)",
    ]) {
      expect(() => normalizeApiHost(bad), bad).toThrow();
    }
  });

  it("matches the build output when one exists", () => {
    for (const target of ["chrome", "firefox"]) {
      const built = resolve(EXT, `dist-${target}`, "manifest.json");
      if (!existsSync(built)) continue;
      const text = readFileSync(built, "utf8");
      expect(text, built).not.toMatch(/__[A-Z_]+__/);
      expect(JSON.parse(text).version).toBe(pkg.version);
    }
  });
});

describe("README permission table", () => {
  const readme = read("README.md");
  const section = readme.slice(
    readme.indexOf("\n## Permissions"),
    readme.indexOf("\n## Publishing"),
  );
  const rows = section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2); // header and separator
  const documented = rows.flatMap((row) => {
    const firstCell = row.split("|")[1] ?? "";
    return [...firstCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  });

  it("finds the table", () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
  });

  it("lists exactly what the manifests request, no more and no less", () => {
    const requested = [
      ...chromeTpl.permissions,
      ...chromeTpl.host_permissions,
      ...chromeTpl.content_scripts.flatMap((cs) => cs.matches),
    ];
    expect([...documented].sort()).toEqual([...requested].sort());
  });

  it("states the requirements the manifests declare", () => {
    const gecko = firefoxTpl.browser_specific_settings!;
    const major = (v: string) => v.split(".")[0];
    expect(readme).toContain(
      `Chrome ${chromeTpl.minimum_chrome_version} or newer`,
    );
    expect(readme).toContain(
      `Firefox ${major(gecko.gecko.strict_min_version)} or newer`,
    );
    expect(readme).toContain(
      `Firefox for Android ${major(gecko.gecko_android.strict_min_version)} or newer`,
    );
    expect(readme).toContain(
      chromeTpl.commands._execute_action.suggested_key.default,
    );
  });

  it("names the API key page the way the app does", () => {
    expect(readme).not.toMatch(/Profile\s*(?:›|>|→)\s*API Keys/);
    expect(readme).not.toContain("Generate New Key");
    const named = readme.match(
      /Profile\s*(?:›|>|→)\s*Developer\s*(?:›|>|→)\s*API Keys/g,
    );
    expect(named?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
