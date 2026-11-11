/**
 * resolvePendingUser is the one answer to "whose second factor is this?" for
 * POST /auth/2fa/email-send and /auth/2fa/verify. The two routes used to read
 * the three pending cookies in opposite orders, so a browser holding two of
 * them was mailed a code for one account and checked against the other.
 */
import { NextRequest } from "next/server";
import { describe, it, expect, vi } from "vitest";

process.env.API_KEY_ENCRYPTION_KEY = "f".repeat(64);

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));

const { AUTH_2FA_PENDING_COOKIE } = await import("@/lib/config/constants");
const { signPendingToken } = await import("@/lib/auth/pending-2fa");
const {
  resolvePendingUser,
  otherPendingCookies,
  DISCORD_PENDING_COOKIE,
  OAUTH_PENDING_COOKIE,
} = await import("@/lib/auth/pending-user");

function req(cookies: Record<string, string>) {
  return new NextRequest("http://localhost/api/v3/auth/2fa/verify", {
    method: "POST",
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
  });
}

const sign = (userId: number, ts = Date.now()) =>
  signPendingToken({ userId, ts });

describe("resolvePendingUser", () => {
  it("answers missing when there is no pending cookie", async () => {
    expect(await resolvePendingUser(req({}))).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it.each([
    AUTH_2FA_PENDING_COOKIE,
    DISCORD_PENDING_COOKIE,
    OAUTH_PENDING_COOKIE,
  ])("reads the user from %s alone", async (name) => {
    expect(await resolvePendingUser(req({ [name]: sign(4) }))).toEqual({
      ok: true,
      userId: 4,
      cookieName: name,
    });
  });

  it("picks the newest first factor, whichever cookie carries it", async () => {
    const now = Date.now();
    const passwordOlder = {
      [AUTH_2FA_PENDING_COOKIE]: sign(2, now - 60_000),
      [OAUTH_PENDING_COOKIE]: sign(1, now),
    };
    expect(await resolvePendingUser(req(passwordOlder))).toMatchObject({
      ok: true,
      userId: 1,
    });
    const passwordNewer = {
      [AUTH_2FA_PENDING_COOKIE]: sign(2, now),
      [OAUTH_PENDING_COOKIE]: sign(1, now - 60_000),
    };
    expect(await resolvePendingUser(req(passwordNewer))).toMatchObject({
      ok: true,
      userId: 2,
    });
  });

  it("skips a forged cookie rather than letting it shadow a real one", async () => {
    const result = await resolvePendingUser(
      req({
        [DISCORD_PENDING_COOKIE]: "9",
        [AUTH_2FA_PENDING_COOKIE]: sign(3),
      }),
    );
    expect(result).toEqual({
      ok: true,
      userId: 3,
      cookieName: AUTH_2FA_PENDING_COOKIE,
    });
  });

  it("answers expired, naming the cookie, past 2FA_PENDING_MAX_AGE_SECONDS", async () => {
    const result = await resolvePendingUser(
      req({ [DISCORD_PENDING_COOKIE]: sign(3, Date.now() - 60 * 60 * 1000) }),
    );
    expect(result).toEqual({
      ok: false,
      reason: "expired",
      cookieName: DISCORD_PENDING_COOKIE,
    });
  });
});

describe("otherPendingCookies", () => {
  it("names the two a route setting one of them must clear", () => {
    expect(otherPendingCookies(OAUTH_PENDING_COOKIE).sort()).toEqual(
      [AUTH_2FA_PENDING_COOKIE, DISCORD_PENDING_COOKIE].sort(),
    );
    expect(otherPendingCookies(AUTH_2FA_PENDING_COOKIE)).not.toContain(
      AUTH_2FA_PENDING_COOKIE,
    );
  });
});
