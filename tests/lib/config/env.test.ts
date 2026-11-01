import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Startup env validation, and the shape of env the documented compose quick
 * start actually hands it. The quick start used to crash-loop: compose
 * forwarded CONTACT_EMAIL and SUPPORT_EMAIL as empty strings, and the schema
 * rejected "" as an invalid email, so `docker compose up -d` on a fresh .env
 * never booted.
 */

const ROOT = path.resolve(__dirname, "../../..");
const KEY = "a".repeat(64);

const savedEnv = process.env;

afterEach(() => {
  process.env = savedEnv;
});

// validateEnv caches its first result, so every case gets a fresh module and
// a process.env holding only what the case puts in it.
async function validate(env: Record<string, string>) {
  process.env = { ...env } as NodeJS.ProcessEnv;
  vi.resetModules();
  const { validateEnv } = await import("@/lib/config/env");
  return validateEnv();
}

const REQUIRED = {
  DATABASE_URL: "postgresql://vulnradar:pw@postgres:5432/vulnradar",
  API_KEY_ENCRYPTION_KEY: KEY,
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

/** The `environment:` map of a compose file's app service, uninterpolated. */
function appEnvironment(file: string): Record<string, string> {
  const lines = readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/);
  const app = lines.indexOf("  app:");
  expect(app, `${file} has no app service`).toBeGreaterThan(-1);
  const start = lines.indexOf("    environment:", app);
  expect(start, `${file}'s app service has no environment map`).toBeGreaterThan(
    -1,
  );
  const out: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const entry = line.match(/^ {6}([A-Z0-9_]+):\s*(.*)$/);
    if (!entry) break;
    out[entry[1]] = entry[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

/** Compose's own `${VAR}`, `${VAR:-default}` and `${VAR:?message}` rules. */
function interpolate(
  map: Record<string, string>,
  shell: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(map)) {
    out[name] = raw.replace(
      /\$\{([A-Z0-9_]+)(?::([-?])([^}]*))?\}/g,
      (_, ref: string, op: string | undefined, arg: string) => {
        const value = shell[ref];
        if (value) return value;
        if (op === "?") throw new Error(`compose refuses: ${arg}`);
        return op === "-" ? arg : "";
      },
    );
  }
  return out;
}

// What a quick-start .env looks like after copying .env.example and filling
// in only the two values compose insists on. The two support addresses are
// written out empty, which env_file forwards as "" rather than leaving unset.
const QUICK_START_DOTENV = {
  POSTGRES_PASSWORD: "pw",
  API_KEY_ENCRYPTION_KEY: KEY,
  CONTACT_EMAIL: "",
  SUPPORT_EMAIL: "",
};

describe.each(["docker-compose.yml", "docker-compose.dev.yml"])(
  "%s quick start",
  (file) => {
    it("boots: the app's env passes validation with both emails empty", async () => {
      // env_file goes in first; the environment map wins where both set a key.
      const env = {
        ...QUICK_START_DOTENV,
        ...interpolate(appEnvironment(file), QUICK_START_DOTENV),
      };
      expect(env.CONTACT_EMAIL).toBe("");
      expect(env.SUPPORT_EMAIL).toBe("");
      await expect(validate(env)).resolves.toMatchObject({
        CONTACT_EMAIL: undefined,
        SUPPORT_EMAIL: undefined,
      });
    });

    it("forwards .env through env_file rather than one ${X:-} line per variable", () => {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      const app = source.slice(source.indexOf("\n  app:"));
      // Without env_file, dropping the pass-throughs would make every
      // optional variable unreachable from .env.
      expect(app).toMatch(/\n {4}env_file:\n {6}- path: \.env\n/);
      // An empty default turns "not set" into "set to nothing", which is
      // what crash-looped the quick start. Build args are not env and are
      // not covered by env_file, so only the runtime map is checked.
      const passThroughs = Object.entries(appEnvironment(file)).filter(
        ([, value]) => /\$\{[A-Z0-9_]+:-\}/.test(value),
      );
      expect(passThroughs).toEqual([]);
    });
  },
);

describe("empty optional values count as unset", () => {
  const OPTIONAL_WITH_FORMAT = [
    "AUTH_SECRET",
    "CONTACT_EMAIL",
    "SUPPORT_EMAIL",
    "DATABASE_SSL",
  ];
  const OPTIONAL_PLAIN = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "SMTP_EHLO_NAME",
    "TURNSTILE_SECRET_KEY",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "TRUSTED_PROXY_CIDR",
  ];

  it.each([...OPTIONAL_WITH_FORMAT, ...OPTIONAL_PLAIN])(
    "%s=''",
    async (name) => {
      const env = await validate({ ...REQUIRED, [name]: "" });
      expect(env[name as keyof typeof env]).toBeUndefined();
    },
  );

  it("still validates a value that is actually set", async () => {
    const env = await validate({
      ...REQUIRED,
      CONTACT_EMAIL: "support@example.com",
      DATABASE_SSL: "true",
    });
    expect(env.CONTACT_EMAIL).toBe("support@example.com");
    expect(env.DATABASE_SSL).toBe(true);
  });

  it.each([
    ["CONTACT_EMAIL", "not-an-email"],
    ["SUPPORT_EMAIL", "support"],
    ["AUTH_SECRET", "too-short"],
    ["DATABASE_SSL", "1"],
  ])("still rejects %s=%s", async (name, value) => {
    await expect(validate({ ...REQUIRED, [name]: value })).rejects.toThrow(
      name,
    );
  });

  it("does not let an empty required value through", async () => {
    await expect(
      validate({ ...REQUIRED, NEXT_PUBLIC_APP_URL: "" }),
    ).rejects.toThrow("NEXT_PUBLIC_APP_URL");
    await expect(
      validate({ ...REQUIRED, API_KEY_ENCRYPTION_KEY: "" }),
    ).rejects.toThrow("API_KEY_ENCRYPTION_KEY");
  });
});
