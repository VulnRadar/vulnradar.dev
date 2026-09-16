import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cookiesRequireHttps } from "@/lib/auth/cookie-secure";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cookiesRequireHttps", () => {
  it("is on in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_INSECURE_HTTP", "");
    expect(cookiesRequireHttps()).toBe(true);
  });

  // ALLOW_INSECURE_HTTP=1 is documented as the way to run with no TLS at all.
  // A browser drops a Secure cookie delivered over plain HTTP, so while this
  // stayed on, nobody could stay signed in on such a deployment.
  it("is off in production when the operator allowed plain HTTP", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_INSECURE_HTTP", "1");
    expect(cookiesRequireHttps()).toBe(false);
  });

  it("only the exact value 1 turns it off", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_INSECURE_HTTP", "true");
    expect(cookiesRequireHttps()).toBe(true);
  });

  it("is off outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(cookiesRequireHttps()).toBe(false);
  });
});

describe("auth cookies decide Secure in one place", () => {
  // Eleven sites used to decide it themselves, in two different ways, and
  // neither honoured ALLOW_INSECURE_HTTP.
  it("no cookie option computes secure: from NODE_ENV or a URL", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "scanner")
            continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          if (
            /secure:\s*(?:process\.env\.NODE_ENV|\w*[uU]rl\.startsWith)/.test(
              src,
            )
          ) {
            offenders.push(path.relative(process.cwd(), full));
          }
        }
      }
    };
    walk(path.resolve("app"));
    walk(path.resolve("lib"));
    expect(offenders).toEqual([]);
  });
});
