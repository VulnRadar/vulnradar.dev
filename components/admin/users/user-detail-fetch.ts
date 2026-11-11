import {
  STAFF_PERMISSIONS,
  hasStaffPermission,
} from "@/lib/auth/permissions-client";
import { API } from "@/lib/config/client-constants";
import {
  isUserDetailResponse,
  type AdminUserDetailResponse,
} from "@/components/admin/types.responses";
import type { UserDetail } from "@/components/admin/types";

/**
 * What to tell the operator when opening an account failed.
 *
 * The route answers 403 for a role without VIEW_USERS and 404 for an id that
 * is gone (a deleted account, a stale link from an old audit row). Both used to
 * be stored as if they were the account, which took the whole panel down, so
 * the words are chosen here by status and not left to whatever the body says.
 */
export function userDetailFailure(
  status: number,
  body: { error?: string } | null | undefined,
): string {
  if (status === 403) return "Your role cannot view accounts.";
  if (status === 404) return "That account no longer exists.";
  return body?.error || "Failed to load user details.";
}

export type UserDetailOutcome =
  | { ok: true; detail: UserDetail }
  | { ok: false; status: number; message: string };

/**
 * One read of an account record, as a value the page can act on without
 * trusting the body.
 *
 * Only a 2xx response that actually carries a `user` becomes a record. An
 * error body (403, 404, a gateway page) comes back as a message instead, so
 * the caller toasts it and shows the list, and never stores it as the selected
 * user. `refresh` marks a reload after the operator's own write, which the
 * route does not log as a view.
 */
export async function loadUserDetail(
  userId: number,
  refresh: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<UserDetailOutcome> {
  try {
    const res = await fetchImpl(
      `${API.ADMIN}?section=user-detail&userId=${userId}${refresh ? "&refresh=1" : ""}`,
    );
    const body: AdminUserDetailResponse | null = await res
      .json()
      .catch(() => null);
    if (res.ok && isUserDetailResponse(body)) {
      return { ok: true, detail: body };
    }
    return {
      ok: false,
      status: res.status,
      message: userDetailFailure(
        res.status,
        body && "error" in body ? body : null,
      ),
    };
  } catch {
    return { ok: false, status: 0, message: userDetailFailure(0, null) };
  }
}

/**
 * Whether a "user #N" reference may be a link. The account page needs
 * VIEW_USERS, so a role without it (ops, for one) gets plain text rather than
 * a link that can only end in a refusal.
 */
export function canOpenUserRecords(role: string | null | undefined): boolean {
  return hasStaffPermission(role, STAFF_PERMISSIONS.VIEW_USERS);
}
