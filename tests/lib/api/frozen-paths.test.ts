import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FROZEN } from "@/lib/api/frozen-paths";
import { PERMALINKS } from "@/lib/api/route-registry";

/** Every FROZEN entry rendered with the placeholder that names its parameter in the registry. */
const rendered: string[] = Object.values(FROZEN).map((value) => {
  if (typeof value !== "function") return value;
  return value === FROZEN.OAUTH_CALLBACK
    ? FROZEN.OAUTH_CALLBACK(":provider")
    : FROZEN.AVATAR(":userId");
});

describe("FROZEN", () => {
  it("holds exactly the strings the third parties have", () => {
    expect(FROZEN.HEALTH).toBe("/api/v3/health");
    expect(FROZEN.STRIPE_WEBHOOK).toBe("/api/v3/webhooks/stripe");
    expect(FROZEN.UNSUBSCRIBE).toBe("/api/v3/account/unsubscribe");
    expect(FROZEN.DISCORD_CALLBACK).toBe("/api/v3/auth/discord/callback");
    expect(FROZEN.OAUTH_CALLBACK("google")).toBe(
      "/api/v3/auth/oauth/google/callback",
    );
    expect(FROZEN.OAUTH_CALLBACK("github")).toBe(
      "/api/v3/auth/oauth/github/callback",
    );
    expect(FROZEN.STAFF_OIDC_CALLBACK).toBe("/api/v3/auth/staff-oidc/callback");
    expect(FROZEN.WHOAMI_IP).toBe("/api/v3/whoami-ip");
    expect(FROZEN.AVATAR(42)).toBe("/api/v3/avatar/42");
    expect(FROZEN.AVATAR("abc")).toBe("/api/v3/avatar/abc");
    expect(FROZEN.BADGE).toBe("/api/v3/badge");
    expect(FROZEN.OPENAPI_V3).toBe("/api/v3/openapi.json");
    expect(FROZEN.VERSION).toBe("/api/version");
    expect(FROZEN.SECURITY_TXT).toBe("/api/security-txt");
  });

  it("produces every PERMALINKS template, and every PERMALINKS template comes from it", () => {
    // The badge permalink is the base plus the token segment; every other
    // entry is the template itself.
    const produced = rendered.map((path) =>
      path === FROZEN.BADGE ? `${FROZEN.BADGE}/:token` : path,
    );
    expect([...produced].sort()).toEqual(
      PERMALINKS.map((link) => link.template).sort(),
    );
  });

  it("has one entry per permalink", () => {
    expect(Object.keys(FROZEN)).toHaveLength(PERMALINKS.length);
  });

  it("imports nothing", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../../../lib/api/frozen-paths.ts", import.meta.url),
      ),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
