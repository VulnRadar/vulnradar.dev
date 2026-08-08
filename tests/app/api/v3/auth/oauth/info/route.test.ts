import { describe, it, expect, afterEach } from "vitest";

/**
 * GET /api/v3/auth/oauth/info -- the public "tell the client what's
 * configured" endpoint the login/signup forms poll to decide which
 * provider buttons to render. No secrets should ever appear in the
 * response, only booleans.
 */

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("GET /api/v3/auth/oauth/info", () => {
  it("reports every provider as false when nothing is configured", async () => {
    const { GET } = await import("@/app/api/v3/auth/oauth/info/route");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ google: false, github: false, discord: false });
  });

  it("reports only the fully-configured providers as true", async () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GITHUB_CLIENT_ID = "id-only"; // secret missing on purpose
    const { GET } = await import("@/app/api/v3/auth/oauth/info/route");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ google: true, github: false, discord: false });
  });

  it("never includes a client secret value in the response", async () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "super-secret-value";
    const { GET } = await import("@/app/api/v3/auth/oauth/info/route");
    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain("super-secret-value");
  });
});
