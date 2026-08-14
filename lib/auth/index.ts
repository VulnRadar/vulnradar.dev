export {
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  createUser,
  createOAuthUser,
  OAUTH_IDENTITY_COLUMNS,
  getUserByEmail,
  cleanupExpiredSessions,
  deleteAllSessions,
  hashSessionId,
  listUserSessions,
  findUserSessionByHash,
  deleteSessionById,
} from "./auth";

// Was re-exported from a now-deleted lib/auth/permissions.ts, an entirely
// separate legacy permission system (its own hardcoded 4-role
// isStaffRole/canAccessAdmin/canManageRole, stuck since before
// STAFF_PERMISSIONS/ROLE_PERMISSION_MAP existed) that shadowed these exact
// names -- an `import { isStaffRole } from "@/lib/auth"` would have
// silently resolved to a version that never learned about the specialist
// staff roles added since. Nothing in the codebase actually imported
// these from the barrel (every real call site already went straight to
// "@/lib/auth/permissions-client"), so re-pointing here is a pure
// correctness fix, not a behavior change for any existing caller.
export {
  isStaffRole,
  hasStaffPermission,
  canAccessAdmin,
  canAccessStaffPage,
  getStaffPermissions,
  canManageRole,
  getAvailableActions,
} from "./permissions-client";

export type { StaffPermission } from "./permissions-client";
