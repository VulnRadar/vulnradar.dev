import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

/**
 * Shared builder helpers for the app/api/v3/auth route suites.
 *
 * These are plain factory functions, not vi.mock registrations, since
 * Vitest hoists vi.mock calls per test file, so every *.test.ts in this
 * tree still declares its own vi.mock("@/lib/database/db", ...) /
 * vi.mock("next/headers", ...) calls at the top. This file only removes
 * the boilerplate of building the fake next/headers cookie/header stores,
 * a default session row shape, and a JSON NextRequest, so each suite reads
 * as its route's behavior rather than repeated fixture plumbing.
 *
 * Per tests/README.md: mock at the network/database boundary (the pg pool
 * and outbound email), never below it. getSession/createSession/
 * destroySession/hashPassword/verifyPassword all run for real against the
 * mocked pool and the fake next/headers cookie jar built here.
 */

export function makeCookieStore() {
  const state = new Map<string, string>();
  const store = {
    get: (name: string) => {
      const value = state.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      state.set(name, value);
    },
    delete: (name: string) => {
      state.delete(name);
    },
  };
  return { state, store };
}

export function makeHeaderStore(initial: Record<string, string> = {}) {
  const state = new Map<string, string>(
    Object.entries(initial).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const store = {
    get: (name: string) => state.get(name.toLowerCase()) ?? null,
  };
  return { state, store };
}

/** Builds a NextRequest with a JSON body and, optionally, a Cookie header
 *  (NextRequest parses its own `.cookies` jar from that header, which is
 *  separate from the next/headers cookies() store used by getSession). */
export function jsonRequest(
  url: string,
  method: string,
  body?: unknown,
  opts: {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
  } = {},
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...opts.headers,
  };
  if (opts.cookies) {
    headers.cookie = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  return new NextRequest(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const cleanInput = input.replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of cleanInput) {
    const idx = BASE32_CHARS.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * RFC 4226 HOTP-SHA1 (the standard TOTP is built on), used only to produce
 * a valid *input* code for the real, unmocked verifyTOTP() (lib/auth/totp.ts)
 * to check inside the route under test. This is not a stand-in for
 * verifyTOTP: the route still calls the real function against a real
 * decrypted secret; this just computes what a real authenticator app would
 * display for a given base32 secret, the same way any independent TOTP
 * client implementation would.
 */
export function computeTotpCode(
  base32Secret: string,
  stepOffset = 0,
  timeStep = 30,
): string {
  const counter = Math.floor(Date.now() / 1000 / timeStep) + stepOffset;
  const key = base32Decode(base32Secret);
  const buffer = Buffer.alloc(8);
  let tmp = counter;
  for (let i = 7; i >= 0; i--) {
    buffer[i] = tmp & 0xff;
    tmp = Math.floor(tmp / 256);
  }
  const hmac = createHmac("sha1", key);
  hmac.update(buffer);
  const hmacResult = hmac.digest();
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, "0");
}

/** The row shape auth.ts's getSession() query returns (sessions JOIN users). */
export function defaultSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 1,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ip_address: null,
    email: "user@example.com",
    name: "Test User",
    tos_accepted_at: null,
    disabled_at: null,
    role: "user",
    ...overrides,
  };
}
