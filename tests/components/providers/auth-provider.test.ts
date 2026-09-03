/**
 * computeAuthPresence decides what the browser should cache for a given
 * /api/v3/auth/me result. The regression this guards: a logged-out result
 * (a 401 body with no userId, or a null/undefined me from a failed fetch)
 * MUST clear the cache + injected CSS, so a session revoked elsewhere
 * ("Sign out everywhere", an admin force-logout, another device, or plain
 * expiry) cannot leave this browser showing a signed-in shell on the next
 * visit. Pure function, so no DOM/jsdom is needed.
 */
import { describe, it, expect } from "vitest";
import {
  computeAuthPresence,
  type AuthPresenceInput,
} from "@/lib/auth/auth-presence";

// The shape /me actually returns when the session is gone: ApiResponse
// .unauthorized() => a JSON body with no userId. The SWR fetcher parses it
// into `me`, so `me` is a truthy object that must still read as logged out.
const LOGGED_OUT_BODY = {
  success: false,
  error: "Authentication required",
} as unknown as AuthPresenceInput;

describe("computeAuthPresence", () => {
  it("clears the cache and both flags when /me reports logged out (401 body with no userId)", () => {
    expect(computeAuthPresence(LOGGED_OUT_BODY)).toEqual({
      cache: null,
      auth: false,
      staff: false,
    });
  });

  it("clears the cache and both flags when /me is null/undefined (fetch failed)", () => {
    const cleared = { cache: null, auth: false, staff: false };
    expect(computeAuthPresence(null)).toEqual(cleared);
    expect(computeAuthPresence(undefined)).toEqual(cleared);
  });

  it("caches the user and reveals auth-only UI when signed in", () => {
    const me = {
      userId: 7,
      role: "user",
      email: "a@b.c",
    } as unknown as AuthPresenceInput;
    const { cache, auth, staff } = computeAuthPresence(me);
    expect(cache).toBe(JSON.stringify(me));
    expect(auth).toBe(true);
    expect(staff).toBe(false);
  });

  it("reveals staff-only UI for a staff role", () => {
    const { auth, staff } = computeAuthPresence({
      userId: 1,
      role: "admin",
    } as unknown as AuthPresenceInput);
    expect(auth).toBe(true);
    expect(staff).toBe(true);
  });

  it("returns flags, never a stylesheet", () => {
    // The regression this guards: a css string here existed only so the
    // pre-hydration script could build a <style> element and append it to
    // document.head. Appending to the head before React hydrates made React
    // treat the markup as mismatched and regenerate the tree on the client,
    // which replayed every route's loading.tsx over the page's own skeleton.
    // Reintroducing a stylesheet here would bring that back.
    const out = computeAuthPresence({
      userId: 1,
      role: "admin",
    } as unknown as AuthPresenceInput);
    expect(out).not.toHaveProperty("css");
    // No returned value may be a CSS rule: the flags are booleans and the
    // cache is the verbatim /me JSON, so nothing here should carry a selector.
    for (const value of Object.values(out)) {
      if (typeof value === "string") {
        expect(value).not.toMatch(/.vr-|!important|{s*[a-z-]+s*:/);
      }
    }
  });
});
