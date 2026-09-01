import { describe, it, expect } from "vitest";
import {
  ERROR_MESSAGES,
  PASSWORD_MIN_LENGTH,
  API,
  API_CURRENT_VERSION,
} from "@/lib/config/constants";
import { PUBLIC_PATHS } from "@/lib/config/public-paths";

/**
 * The four functions in lib/config/constants.ts, as opposed to its several
 * hundred plain values.
 *
 * They are here because every one of them had already shipped wrong once, in
 * the same way: a message that states a number, written next to the constant
 * that holds the real number, and nothing comparing the two. WEAK_PASSWORD
 * said "at least 8 characters" four lines below the export that sets the
 * minimum to 12. TOO_MANY_ATTEMPTS is the correct version of a sentence that
 * thirty-one routes still reimplement inline, every one of them printing the
 * literal "1 minute(s)". Values cannot drift like that on their own; the
 * functions can, so the functions get the tests.
 */
describe("ERROR_MESSAGES.WEAK_PASSWORD", () => {
  it("states the minimum it is given rather than a baked-in number", () => {
    expect(ERROR_MESSAGES.WEAK_PASSWORD(12)).toBe(
      "Password must be at least 12 characters long.",
    );
    expect(ERROR_MESSAGES.WEAK_PASSWORD(20)).toBe(
      "Password must be at least 20 characters long.",
    );
  });

  it("agrees with PASSWORD_MIN_LENGTH when handed it", () => {
    // The regression that made this a function: the old flat string said 8
    // while PASSWORD_MIN_LENGTH was 12, so a caller would have told the user
    // a rule the signup form does not enforce.
    expect(ERROR_MESSAGES.WEAK_PASSWORD(PASSWORD_MIN_LENGTH)).toContain(
      `at least ${PASSWORD_MIN_LENGTH} characters`,
    );
    expect(ERROR_MESSAGES.WEAK_PASSWORD(PASSWORD_MIN_LENGTH)).not.toContain(
      "at least 8 characters",
    );
  });
});

describe("ERROR_MESSAGES.TOO_MANY_ATTEMPTS", () => {
  it("says 'minute' for one and 'minutes' for more than one", () => {
    // This is the whole reason the shared helper exists. The inline copies
    // scattered through the routes print "Please try again in 1 minute(s)."
    expect(ERROR_MESSAGES.TOO_MANY_ATTEMPTS("login attempts", 1)).toBe(
      "Too many login attempts. Please wait 1 minute before trying again.",
    );
    expect(ERROR_MESSAGES.TOO_MANY_ATTEMPTS("login attempts", 5)).toBe(
      "Too many login attempts. Please wait 5 minutes before trying again.",
    );
    expect(ERROR_MESSAGES.TOO_MANY_ATTEMPTS("login attempts", 1)).not.toContain(
      "minute(s)",
    );
  });

  it("takes the whole noun phrase and does not append a word of its own", () => {
    // The regression this pins: the template used to append a literal
    // " attempts", while all four live callers already passed a phrase
    // ending in it, so users on the forgot-password and signup limits read
    // "Too many reset attempts attempts." It also has to work for the
    // rate limits that are not attempts at anything.
    expect(ERROR_MESSAGES.TOO_MANY_ATTEMPTS("reset attempts", 5)).toBe(
      "Too many reset attempts. Please wait 5 minutes before trying again.",
    );
    expect(ERROR_MESSAGES.TOO_MANY_ATTEMPTS("reset attempts", 5)).not.toContain(
      "attempts attempts",
    );
    expect(ERROR_MESSAGES.TOO_MANY_ATTEMPTS("AI requests", 2)).toBe(
      "Too many AI requests. Please wait 2 minutes before trying again.",
    );
  });
});

describe("ERROR_MESSAGES.REQUIRED_FIELD", () => {
  it("names the field", () => {
    expect(ERROR_MESSAGES.REQUIRED_FIELD("Email")).toBe("Email is required.");
  });
});

// Asserted against `API` rather than the old API_V3 map. API_V3 was a second,
// fully hardcoded copy of the same routes and has been deleted; `API` is the
// one built from API_VERSION, so these assertions are now checking the map
// that callers actually use (AUDIT-014#hc-10).
describe("API.SCAN_DISCOVER_PROGRESS", () => {
  it("builds the progress path under the same version prefix as its siblings", () => {
    expect(API.SCAN_DISCOVER_PROGRESS("abc123")).toBe(
      "/api/v3/scan/discover/progress/abc123",
    );
    // The point of building routes from one map is that they cannot drift
    // apart. API_CURRENT_VERSION is the single declaration of "v3"; a path
    // that stopped matching it would be a route the client asks for and the
    // server does not serve.
    expect(API.SCAN_DISCOVER_PROGRESS("abc123")).toContain(
      `/api/${API_CURRENT_VERSION}/`,
    );
    expect(API.SCAN_DISCOVER_PROGRESS("abc123")).toContain(API.SCAN_DISCOVER);
  });

  it("interpolates the id it is given, including one with url-unsafe characters", () => {
    // Documents that the map does NOT encode: callers pass request ids the
    // server generated, and anything else is the caller's job to encode.
    expect(API.SCAN_DISCOVER_PROGRESS("a/b")).toBe(
      "/api/v3/scan/discover/progress/a/b",
    );
  });
});

// The allowlist in lib/config/public-paths.ts is the middleware's only source
// of "this route needs no session". It used to be built from the hardcoded
// API_V3 map, so a version bump would have left the middleware allowing
// /api/v3/... while the client asked for /api/v4/... and every public
// endpoint 307'd logged-out visitors to /login. Now that it reads `API`, this
// asserts the coupling rather than trusting it.
describe("PUBLIC_PATHS tracks the API map", () => {
  it("allowlists the versioned auth and public routes by reference", () => {
    for (const route of [
      API.AUTH.LOGIN,
      API.AUTH.SIGNUP,
      API.AUTH.TWO_FA.VERIFY,
      API.DEMO_SCAN,
      API.CONTACT,
      API.LANDING_CONTACT,
      API.FINDING_TYPES,
    ]) {
      expect(PUBLIC_PATHS).toContain(route);
    }
  });

  it("carries no entry with a fragment or query, which a pathname match can never hit", () => {
    // ROUTES.GDPR_REQUEST ("/legal/privacy#gdpr") was listed here and was
    // dead for exactly this reason. The "/legal" prefix entry covers it.
    for (const path of PUBLIC_PATHS) {
      expect(path).not.toMatch(/[#?]/);
    }
  });
});
