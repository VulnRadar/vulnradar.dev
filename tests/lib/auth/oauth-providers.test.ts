import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isOAuthProviderId,
  isOAuthProviderConfigured,
  getOAuthClientId,
  getOAuthClientSecret,
  oauthLabelForAuthProvider,
  OAUTH_PROVIDERS,
} from "@/lib/auth/oauth-providers";

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("isOAuthProviderId", () => {
  it("accepts the three known providers", () => {
    expect(isOAuthProviderId("google")).toBe(true);
    expect(isOAuthProviderId("github")).toBe(true);
    expect(isOAuthProviderId("discord")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isOAuthProviderId("facebook")).toBe(false);
    expect(isOAuthProviderId("")).toBe(false);
    expect(isOAuthProviderId("Google")).toBe(false);
  });
});

describe("isOAuthProviderConfigured", () => {
  it("is false when neither env var is set", () => {
    expect(isOAuthProviderConfigured("google")).toBe(false);
  });

  it("is false when only the client id is set", () => {
    process.env.GOOGLE_CLIENT_ID = "abc";
    expect(isOAuthProviderConfigured("google")).toBe(false);
  });

  it("is false when only the client secret is set", () => {
    process.env.GOOGLE_CLIENT_SECRET = "abc";
    expect(isOAuthProviderConfigured("google")).toBe(false);
  });

  it("is true once both the client id and secret are set", () => {
    process.env.GOOGLE_CLIENT_ID = "abc";
    process.env.GOOGLE_CLIENT_SECRET = "def";
    expect(isOAuthProviderConfigured("google")).toBe(true);
  });

  it("checks each provider independently", () => {
    process.env.GITHUB_CLIENT_ID = "abc";
    process.env.GITHUB_CLIENT_SECRET = "def";
    expect(isOAuthProviderConfigured("github")).toBe(true);
    expect(isOAuthProviderConfigured("google")).toBe(false);
    expect(isOAuthProviderConfigured("discord")).toBe(false);
  });
});

describe("getOAuthClientId / getOAuthClientSecret", () => {
  it("reads from the provider's own env vars", () => {
    process.env.DISCORD_CLIENT_ID = "discord-id";
    process.env.DISCORD_CLIENT_SECRET = "discord-secret";
    expect(getOAuthClientId("discord")).toBe("discord-id");
    expect(getOAuthClientSecret("discord")).toBe("discord-secret");
  });

  it("returns undefined when unset", () => {
    expect(getOAuthClientId("google")).toBeUndefined();
    expect(getOAuthClientSecret("google")).toBeUndefined();
  });
});

describe("oauthLabelForAuthProvider", () => {
  it("returns the provider's display label for a known provider", () => {
    expect(oauthLabelForAuthProvider("google")).toBe(OAUTH_PROVIDERS.google.label);
    expect(oauthLabelForAuthProvider("github")).toBe(OAUTH_PROVIDERS.github.label);
    expect(oauthLabelForAuthProvider("discord")).toBe(OAUTH_PROVIDERS.discord.label);
  });

  it("returns null for 'password' (not an OAuth provider)", () => {
    expect(oauthLabelForAuthProvider("password")).toBeNull();
  });

  it("returns null for null (legacy row created before auth_provider existed)", () => {
    expect(oauthLabelForAuthProvider(null)).toBeNull();
  });

  it("returns null for an unrecognized value rather than throwing", () => {
    expect(oauthLabelForAuthProvider("something-unexpected")).toBeNull();
  });
});
