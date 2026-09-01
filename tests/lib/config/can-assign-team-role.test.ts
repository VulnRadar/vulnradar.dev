import { describe, it, expect } from "vitest";
import {
  TEAM_ROLES,
  TEAM_ROLE_PERMISSIONS,
  canAssignTeamRole,
} from "@/lib/config/constants";

/**
 * canAssignTeamRole is the team-side privilege ceiling: a caller may only
 * grant, or act on, a role whose permission set is a SUBSET of its own. It
 * had no test at all, while its three call sites in
 * app/api/v3/teams/members/route.ts (invite, remove, change role) are the
 * only thing standing between a team manager and escalation by proxy.
 *
 * The relation is a partial order, not a ladder: manager holds
 * manage_members but not manage_scans, and operator is exactly the reverse,
 * so neither can act on the other and a numeric rank cannot express it.
 * These tests pin the partial order directly, so a refactor that swaps in a
 * rank comparison, or that drops one half of the PATCH check (which
 * deliberately validates both the target's CURRENT role and the NEW one),
 * fails here rather than in production.
 */
describe("canAssignTeamRole", () => {
  const ALL_ROLES = Object.values(TEAM_ROLES);

  it("lets the owner act on every role, including another owner", () => {
    for (const role of ALL_ROLES) {
      expect(canAssignTeamRole(TEAM_ROLES.OWNER, role)).toBe(true);
    }
  });

  it("never lets a non-owner act on the owner", () => {
    for (const role of ALL_ROLES) {
      if (role === TEAM_ROLES.OWNER) continue;
      expect(canAssignTeamRole(role, TEAM_ROLES.OWNER)).toBe(false);
    }
  });

  it("stops a manager promoting anyone to admin, which would hand out manage_scans it does not hold", () => {
    expect(canAssignTeamRole(TEAM_ROLES.MANAGER, TEAM_ROLES.ADMIN)).toBe(false);
    expect(TEAM_ROLE_PERMISSIONS[TEAM_ROLES.MANAGER]).not.toContain(
      "manage_scans",
    );
    expect(TEAM_ROLE_PERMISSIONS[TEAM_ROLES.ADMIN]).toContain("manage_scans");
  });

  it("stops a manager removing or demoting an admin that outranks it", () => {
    expect(canAssignTeamRole(TEAM_ROLES.MANAGER, TEAM_ROLES.ADMIN)).toBe(false);
  });

  it("stops a manager acting on an operator or a member, since both hold manage_scans", () => {
    expect(canAssignTeamRole(TEAM_ROLES.MANAGER, TEAM_ROLES.OPERATOR)).toBe(
      false,
    );
    expect(canAssignTeamRole(TEAM_ROLES.MANAGER, TEAM_ROLES.MEMBER)).toBe(
      false,
    );
  });

  it("stops an operator acting on a manager, since manager holds manage_members", () => {
    expect(canAssignTeamRole(TEAM_ROLES.OPERATOR, TEAM_ROLES.MANAGER)).toBe(
      false,
    );
  });

  it("lets a role act on a strictly weaker one", () => {
    expect(canAssignTeamRole(TEAM_ROLES.ADMIN, TEAM_ROLES.MANAGER)).toBe(true);
    expect(canAssignTeamRole(TEAM_ROLES.ADMIN, TEAM_ROLES.OPERATOR)).toBe(true);
    expect(canAssignTeamRole(TEAM_ROLES.ADMIN, TEAM_ROLES.MEMBER)).toBe(true);
    expect(canAssignTeamRole(TEAM_ROLES.MANAGER, TEAM_ROLES.VIEWER)).toBe(true);
    expect(canAssignTeamRole(TEAM_ROLES.OPERATOR, TEAM_ROLES.MEMBER)).toBe(
      true,
    );
  });

  it("lets a role act on its own peer", () => {
    for (const role of ALL_ROLES) {
      expect(canAssignTeamRole(role, role)).toBe(true);
    }
  });

  it("agrees with the permission table it derives from, for every ordered pair", () => {
    for (const caller of ALL_ROLES) {
      for (const target of ALL_ROLES) {
        const callerPerms = TEAM_ROLE_PERMISSIONS[caller];
        const targetPerms = TEAM_ROLE_PERMISSIONS[target];
        const subset = targetPerms.every((p) => callerPerms.includes(p));
        expect(canAssignTeamRole(caller, target)).toBe(subset);
      }
    }
  });

  it("fails closed on an unknown or missing role on either side", () => {
    expect(canAssignTeamRole("superuser", TEAM_ROLES.VIEWER)).toBe(false);
    expect(canAssignTeamRole(TEAM_ROLES.OWNER, "superuser")).toBe(false);
    expect(canAssignTeamRole(undefined, TEAM_ROLES.VIEWER)).toBe(false);
    expect(canAssignTeamRole(TEAM_ROLES.OWNER, undefined)).toBe(false);
    expect(canAssignTeamRole("", "")).toBe(false);
  });
});
