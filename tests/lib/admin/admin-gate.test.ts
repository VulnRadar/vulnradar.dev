import { describe, it, expect } from "vitest";
import { resolveAdminGate } from "@/lib/admin/admin-gate";

/**
 * The admin page must never flash its loading skeleton to a non-staff
 * visitor: the deny decision has to be reachable from the client's own
 * cached role before the admin API round-trip resolves.
 */
describe("resolveAdminGate", () => {
  const base = {
    forbidden: false,
    authLoading: false,
    viewerIsStaff: true,
    dataLoading: false,
  };

  it("denies when the server returned 403, no matter the client state", () => {
    expect(
      resolveAdminGate({
        ...base,
        forbidden: true,
        viewerIsStaff: true,
        dataLoading: true,
      }),
    ).toBe("deny");
  });

  it("denies immediately once auth resolves to a non-staff viewer", () => {
    expect(
      resolveAdminGate({ ...base, viewerIsStaff: false, dataLoading: true }),
    ).toBe("deny");
  });

  it("shows a neutral loader (never the skeleton) while auth is unresolved for a would-be non-staff viewer", () => {
    expect(
      resolveAdminGate({
        ...base,
        authLoading: true,
        viewerIsStaff: false,
        dataLoading: true,
      }),
    ).toBe("auth-pending");
  });

  it("shows the admin skeleton to a cached-staff viewer while the admin data loads, even before auth confirms", () => {
    expect(
      resolveAdminGate({
        ...base,
        authLoading: true,
        viewerIsStaff: true,
        dataLoading: true,
      }),
    ).toBe("loading");
  });

  it("shows the admin skeleton to a confirmed staff viewer while data loads", () => {
    expect(resolveAdminGate({ ...base, dataLoading: true })).toBe("loading");
  });

  it("is ready once a staff viewer's data has loaded", () => {
    expect(resolveAdminGate(base)).toBe("ready");
  });
});
