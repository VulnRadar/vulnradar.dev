import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * The Authorization header spellings every route that accepts an API key must
 * agree on. One table, so sixteen route files cannot drift into sixteen
 * opinions about what counts as a Bearer header (they used to: fourteen tested
 * `startsWith(BEARER_PREFIX)` and two had their own "Bearer " literal).
 *
 * "Accepted" is observed at the one place that matters: the handler handed the
 * credentials to validateApiKey. "Rejected" is the mirror: it never did, and a
 * caller with no session is turned away with a 401.
 *
 * Plain functions, not vi.mock registrations: vitest hoists vi.mock per test
 * file, so each suite still declares its own mocks for the db, getSession and
 * validateApiKey and passes the spies in.
 */
export const BEARER_TEST_KEY = "vr_live_0123456789abcdef";

const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
  ["Bearer", `Bearer ${BEARER_TEST_KEY}`],
  ["bearer", `bearer ${BEARER_TEST_KEY}`],
  ["BEARER", `BEARER ${BEARER_TEST_KEY}`],
  ["a double space", `Bearer  ${BEARER_TEST_KEY}`],
];

// "Bearer " is sent as-is, but a Headers object drops the trailing space, so
// what the handler sees is the bare scheme. Both spellings are refused, which
// is the point.
const REJECTED: ReadonlyArray<readonly [string, string]> = [
  ["Basic", "Basic dXNlcjpwYXNz"],
  ["an empty token", "Bearer "],
  ["Bearerx", `Bearerx ${BEARER_TEST_KEY}`],
];

/**
 * Factory body for vi.mock("@/lib/config/runtime-config"): every setting
 * resolves to its shipped default, so a handler that reads a flag or a limit
 * before it authenticates (the scan routes read the pause switch first) does
 * not reach for a database the suite does not have.
 */
export async function runtimeConfigDefaults() {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  type Key = keyof typeof SETTINGS_REGISTRY;
  return {
    getSetting: vi.fn(async (key: Key) => SETTINGS_REGISTRY[key].default),
    getSettings: vi.fn(async (keys: Key[]) =>
      Object.fromEntries(keys.map((k) => [k, SETTINGS_REGISTRY[k].default])),
    ),
  };
}

export interface BearerSchemeSubject {
  /** Calls the handler with this exact Authorization header value. */
  call: (authorization: string) => Promise<Response>;
  validateApiKey: Mock;
  getSession: Mock;
}

export function describeBearerScheme(
  label: string,
  subject: BearerSchemeSubject,
): void {
  describe(`${label}: Authorization scheme`, () => {
    beforeEach(() => {
      subject.validateApiKey.mockReset();
      subject.validateApiKey.mockResolvedValue(null);
      subject.getSession.mockReset();
      subject.getSession.mockResolvedValue(null);
    });

    it.each(ACCEPTED)("accepts %s", async (_name, header) => {
      const res = await subject.call(header);
      expect(subject.validateApiKey).toHaveBeenCalledTimes(1);
      expect(subject.validateApiKey).toHaveBeenCalledWith(BEARER_TEST_KEY);
      expect(res.status).toBe(401);
    });

    it.each(REJECTED)("rejects %s", async (_name, header) => {
      const res = await subject.call(header);
      expect(subject.validateApiKey).not.toHaveBeenCalled();
      expect(res.status).toBe(401);
    });
  });
}
