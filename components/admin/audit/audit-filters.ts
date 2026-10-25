/**
 * The audit log's filter state and how it becomes a request.
 *
 * Kept apart from the component so the page that owns the fetch, the log that
 * draws the controls and the per-account history card all build the same query
 * string, and so a unit test can pin it without rendering anything.
 */

export type AuditRange = "all" | "24h" | "7d";

/** A person the log is narrowed to, with the name the chip shows. */
export interface AuditPerson {
  id: number;
  label: string;
}

export interface AuditFilters {
  /** "all" or an AuditCategoryId. */
  category: string;
  q: string;
  range: AuditRange;
  /** Only actions taken BY this staff member. */
  admin: AuditPerson | null;
  /** Only actions taken ON this account. */
  target: AuditPerson | null;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  category: "all",
  q: "",
  range: "all",
  admin: null,
  target: null,
};

const RANGE_MS: Record<Exclude<AuditRange, "all">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

/**
 * The query string section=audit takes. `now` is a parameter so the cutoff is
 * the caller's clock reading, not a hidden one.
 */
export function auditFilterParams(
  filters: AuditFilters,
  now: number = Date.now(),
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.category !== "all") params.set("category", filters.category);
  const q = filters.q.trim();
  if (q) params.set("q", q);
  if (filters.range !== "all") {
    params.set("from", new Date(now - RANGE_MS[filters.range]).toISOString());
  }
  if (filters.admin) params.set("adminId", String(filters.admin.id));
  if (filters.target) params.set("targetUserId", String(filters.target.id));
  return params;
}

export function hasActiveAuditFilters(filters: AuditFilters): boolean {
  return (
    filters.category !== "all" ||
    filters.q.trim() !== "" ||
    filters.range !== "all" ||
    filters.admin !== null ||
    filters.target !== null
  );
}
