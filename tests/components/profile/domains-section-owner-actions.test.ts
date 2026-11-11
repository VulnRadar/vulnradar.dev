/**
 * Which row actions the verified-domains list offers on a teammate's domain.
 *
 * DELETE /api/v3/domains is owner-only (the proof of ownership is the
 * verifier's), so a Remove button on a teammate's row was a control whose only
 * outcome was a 403. A team owner or admin gets Stop sharing there instead:
 * PATCH /api/v3/domains/[id] with teamId null, the one PATCH the route accepts
 * from someone other than the verifier, behind a confirmation because it
 * changes what the rest of the team can do.
 *
 * Source-text assertions: this suite runs in node without a DOM, and the
 * section fetches on mount.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "components/profile/tabs/developer/domains-section.tsx"),
  "utf8",
);

describe("domain row actions", () => {
  it("shows Remove on the caller's own domains only", () => {
    const remove = SRC.indexOf('title="Remove domain"');
    const guard = SRC.lastIndexOf("{isOwn && (", remove);
    expect(guard).toBeGreaterThan(-1);
    expect(SRC.slice(guard, remove)).not.toContain(")}");
  });

  it("offers Stop sharing to an owner or admin of the team, behind a confirmation", () => {
    expect(SRC).toMatch(/t\.role === "owner" \|\| t\.role === "admin"/);
    expect(SRC).toContain('confirmLabel: "Stop sharing"');
    expect(SRC).toContain("JSON.stringify({ teamId: null })");
    expect(SRC).toContain("{confirmDialog}");
  });
});
