import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * serverAppUrl(): the saved setting, then the environment the process is
 * running with, then the shipped default. The pg pool is mocked; the settings
 * cache and the registry's URL validation are the real code.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const ENV_NAMES = ["APP_URL", "NEXT_PUBLIC_APP_URL"] as const;
const saved = new Map<string, string | undefined>();
for (const name of ENV_NAMES) {
  saved.set(name, process.env[name]);
}

// What `next build` would have inlined: the constant is evaluated once, at
// import, from the environment of that moment.
process.env.NEXT_PUBLIC_APP_URL = "https://vulnradar.dev";
delete process.env.APP_URL;
const { APP_URL: BUILD_TIME_APP_URL } =
  await import("@/lib/config/client-constants");
const { CONFIG_APP_URL } = await import("@/lib/config/config-values");
const { serverAppUrl, runtimeEnvAppUrl } =
  await import("@/lib/config/server-app-url");
const { resolveAppUrl, invalidateSettingsCache } =
  await import("@/lib/config/runtime-config");

const noRows = { rows: [] };
const storedAppUrl = (value: string) => ({
  rows: [{ key: "APP_URL", value }],
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue(noRows);
  invalidateSettingsCache();
  for (const name of ENV_NAMES) delete process.env[name];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("serverAppUrl", () => {
  it("uses a NEXT_PUBLIC_APP_URL set at runtime over the build-time constant", async () => {
    expect(BUILD_TIME_APP_URL).toBe("https://vulnradar.dev");
    process.env.NEXT_PUBLIC_APP_URL = "https://scanner.example.org";

    expect(await serverAppUrl()).toBe("https://scanner.example.org");
  });

  it("uses APP_URL set at runtime, ahead of NEXT_PUBLIC_APP_URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://vulnradar.dev";
    process.env.APP_URL = "https://scanner.example.org";

    expect(await serverAppUrl()).toBe("https://scanner.example.org");
  });

  it("uses the saved setting ahead of either variable", async () => {
    process.env.APP_URL = "https://env.example.org";
    process.env.NEXT_PUBLIC_APP_URL = "https://public.example.org";
    mockQuery.mockResolvedValue(storedAppUrl("https://saved.example.org"));

    expect(await serverAppUrl()).toBe("https://saved.example.org");
  });

  it("falls back to the shipped default when nothing is configured", async () => {
    expect(await serverAppUrl()).toBe(CONFIG_APP_URL);
  });

  it("skips a variable that is empty or not a URL", async () => {
    process.env.APP_URL = "";
    process.env.NEXT_PUBLIC_APP_URL = "scanner.example.org";

    expect(runtimeEnvAppUrl()).toBeUndefined();
    expect(await serverAppUrl()).toBe(CONFIG_APP_URL);

    process.env.APP_URL = "not a url";
    process.env.NEXT_PUBLIC_APP_URL = "https://scanner.example.org";
    expect(await serverAppUrl()).toBe("https://scanner.example.org");
  });

  it("ignores a saved row that is not a URL", async () => {
    process.env.APP_URL = "https://env.example.org";
    mockQuery.mockResolvedValue(storedAppUrl("not a url"));

    expect(await serverAppUrl()).toBe("https://env.example.org");
  });

  it("drops a trailing slash so a joined path has one", async () => {
    process.env.APP_URL = "https://scanner.example.org/";
    expect(await serverAppUrl()).toBe("https://scanner.example.org");

    mockQuery.mockResolvedValue(storedAppUrl("https://saved.example.org//"));
    invalidateSettingsCache();
    expect(await serverAppUrl()).toBe("https://saved.example.org");
  });

  it("still answers when the settings table cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(new Error("connection refused"));
    process.env.NEXT_PUBLIC_APP_URL = "https://scanner.example.org";

    expect(await serverAppUrl()).toBe("https://scanner.example.org");
  });
});

describe("resolveAppUrl", () => {
  const request = new Request("https://arrived.example.org/api/v3/auth/x");

  it("follows the same order as serverAppUrl", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://scanner.example.org";
    expect(await resolveAppUrl(request)).toBe("https://scanner.example.org");

    process.env.APP_URL = "https://env.example.org";
    expect(await resolveAppUrl(request)).toBe("https://env.example.org");

    mockQuery.mockResolvedValue(storedAppUrl("https://saved.example.org"));
    invalidateSettingsCache();
    expect(await resolveAppUrl(request)).toBe("https://saved.example.org");
  });

  it("ends at the request's own origin, not the shipped default", async () => {
    expect(await resolveAppUrl(request)).toBe("https://arrived.example.org");
  });
});
