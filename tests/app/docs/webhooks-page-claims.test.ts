/**
 * What /docs/webhooks tells a receiver has to match what a delivery sends.
 * Header names are read off the module that sets them, so renaming one here
 * without the page turns this red.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const {
  ATTEMPT_HEADER,
  DELIVERY_HEADER,
  DELIVERY_TIMEOUT_MS,
  EVENT_HEADER,
  RETRY_DELAY_MS,
  SIGNATURE_HEADER,
  SIGNATURE_V2_HEADER,
  TIMESTAMP_HEADER,
} = await import("@/lib/webhooks/delivery-contract");

const { TEAM_ROLES, hasTeamPermission } =
  await import("@/lib/config/client-constants");

const PAGE = fs.readFileSync(
  path.resolve(__dirname, "../../../app/docs/webhooks/page.tsx"),
  "utf8",
);

/** The page's prose as a reader meets it: JSX line wraps collapsed. */
const PROSE = PAGE.replace(/\s+/g, " ");

describe("/docs/webhooks", () => {
  it.each([
    DELIVERY_HEADER,
    EVENT_HEADER,
    ATTEMPT_HEADER,
    TIMESTAMP_HEADER,
    SIGNATURE_HEADER,
    SIGNATURE_V2_HEADER,
  ])("documents %s", (header) => {
    expect(PAGE).toContain(header);
  });

  it("puts the receiver's section directly after the overview", () => {
    const ids = [...PAGE.matchAll(/<DocsSection\s+id="([a-z-]+)"/g)].map(
      (m) => m[1],
    );
    expect(ids.slice(0, 2)).toEqual(["overview", "receive-and-verify"]);
  });

  it("states the deadline and the retry from the code's own numbers", () => {
    expect(DELIVERY_TIMEOUT_MS).toBe(10000);
    expect(RETRY_DELAY_MS).toBe(5000);
    expect(PAGE).toContain("DELIVERY_TIMEOUT_MS / 1000");
    expect(PAGE).toContain("RETRY_DELAY_MS / 1000");
  });

  it("verifies with the secret as the string it is, in constant time", () => {
    expect(PAGE).toContain("express.raw");
    expect(PAGE).toContain("timingSafeEqual");
    expect(PAGE).toContain("hmac.compare_digest");
    expect(PAGE).not.toMatch(/Buffer\.from\(secret, "hex"\)/);
    expect(PAGE).not.toContain("bytes.fromhex");
  });

  it("no longer says the test is unsigned", () => {
    expect(PROSE).not.toContain("NOT signed");
    expect(PROSE).not.toMatch(/delivery is unsigned/);
    expect(PROSE).toContain("signed with the stored secret");
  });

  it("documents the test event and what never fires", () => {
    expect(PAGE).toContain('event: "test"');
    expect(PROSE).toContain("no data key");
    expect(PROSE).toMatch(/failed, cancelled and timed-out scans never fire/i);
  });

  it("names the real controls", () => {
    expect(PAGE).toContain("Profile > Developer > Webhooks > Add");
    expect(PROSE).toContain("Send test webhook");
    expect(PROSE).toContain("paper-plane");
    expect(PROSE).not.toMatch(/Click <strong[^>]*>Test<\/strong>/);
  });

  it("no longer claims a DELETE of an unknown id succeeds", () => {
    expect(PROSE).not.toContain(
      "returns { success: true } with a 200, not a 404",
    );
  });

  it("states who can see and change what", () => {
    expect(PROSE).not.toContain("All team roles can read them");
    expect(PROSE).toContain("old signatures stop matching at once");
    expect(PROSE).toContain("url_host");
    expect(PROSE).toContain("Only this webhook's creator can change its URL");
  });

  it("names the roles the code gives the address, a manager included", () => {
    const roles = Object.values(TEAM_ROLES);
    const canWrite = roles.filter((r) => hasTeamPermission(r, "manage_scans"));
    const readOnly = roles.filter((r) => !hasTeamPermission(r, "manage_scans"));

    expect(canWrite).toEqual(["owner", "admin", "operator", "member"]);
    expect(readOnly).toEqual(["manager", "viewer"]);
    expect(PROSE).toContain(
      "Teammates whose role manages scans (owner, admin, operator, member)",
    );
    expect(PROSE).toContain("A manager or viewer sees the name and the host");
    expect(PROSE).toContain(
      "cannot write to that webhook: a manager or viewer, or anyone",
    );
  });

  it("gives receivers something to deduplicate and date a delivery by", () => {
    expect(PROSE).toContain("data.scan_id");
    expect(PROSE).toContain("scanned_at");
    expect(PROSE).toMatch(/no timestamp is signed/i);
  });

  it("writes no em or en dash in the new copy", () => {
    expect(PAGE).not.toMatch(/[–—]/);
  });
});
