/**
 * Tests for usableDomainNames, the filter behind useVerifiedDomains and so
 * behind the scan form's "your verified domain covers this host" hint.
 *
 * gap-domain-verification-active-gating-6: the hint counted every verified row
 * GET /api/v3/domains returns, and that list holds teammates' domains shared
 * into a team where this account may only be a viewer or a manager. Those let
 * it SEE the row and not scan under it, so the form offered a port sweep the
 * server refused, and the refusal rejected the whole scan. The route now marks
 * each row with usableForScanning (tests/app/api/v3/domains/route.test.ts
 * proves it per role) and the hint reads only that.
 */
import { describe, expect, it } from "vitest";
import { usableDomainNames } from "@/lib/hooks/use-verified-domains";
import { domainListCovers } from "@/lib/domains/covering";

/** A row as GET /api/v3/domains returns it. */
function row(over: Record<string, unknown>) {
  return {
    id: 1,
    domain: "example.com",
    user_id: 42,
    team_id: null,
    status: "verified",
    usableForScanning: true,
    ...over,
  };
}

describe("usableDomainNames", () => {
  it("keeps the caller's own verified domain", () => {
    expect(usableDomainNames([row({})])).toEqual(["example.com"]);
  });

  it("keeps a teammate's domain for a member, who may scan under the team", () => {
    // What the route answers for a member (manage_scans) of team 5.
    const member = [row({ user_id: 7, team_id: 5, usableForScanning: true })];
    expect(usableDomainNames(member)).toEqual(["example.com"]);
  });

  it("drops the same verified domain for a viewer, who may not", () => {
    const viewer = [row({ user_id: 7, team_id: 5, usableForScanning: false })];
    const names = usableDomainNames(viewer);
    expect(names).toEqual([]);
    // So the form does not claim the port sweep will be allowed.
    expect(domainListCovers("app.example.com", names)).toBe(false);
  });

  it("drops it for a manager too, who manages people but not scans", () => {
    const manager = [row({ user_id: 7, team_id: 5, usableForScanning: false })];
    expect(usableDomainNames(manager)).toEqual([]);
  });

  it("reads the flag, not the status, so a verified row the server refuses is not counted", () => {
    expect(
      usableDomainNames([
        row({ id: 1, domain: "mine.example", usableForScanning: true }),
        row({ id: 2, domain: "shared.example", usableForScanning: false }),
      ]),
    ).toEqual(["mine.example"]);
  });

  it("treats a row without the flag as not usable", () => {
    // An older server, or a malformed answer: a hint that cannot tell must
    // say "not covered", which is what loading and errors already say.
    const { usableForScanning: _omit, ...legacy } = row({});
    expect(usableDomainNames([legacy])).toEqual([]);
    expect(usableDomainNames([row({ usableForScanning: "true" })])).toEqual([]);
  });

  it("lowercases the names it keeps", () => {
    expect(usableDomainNames([row({ domain: "Example.COM" })])).toEqual([
      "example.com",
    ]);
  });

  it.each([undefined, null, "nope", 42, {}])(
    "answers an empty list for a body of %p",
    (body) => {
      expect(usableDomainNames(body)).toEqual([]);
    },
  );

  it("skips entries that are not rows", () => {
    expect(
      usableDomainNames([null, 7, "example.com", row({ domain: 9 }), row({})]),
    ).toEqual(["example.com"]);
  });
});
