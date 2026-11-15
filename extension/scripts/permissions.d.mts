export const HOST_PLACEHOLDER: string;
export const INCREASE_HINT: string;
export interface PermissionAllowlist {
  permissions: string[];
  host_permissions: string[];
  optional_permissions: string[];
  optional_host_permissions: string[];
  content_scripts_matches: string[];
  content_security_policy: { extension_pages: Record<string, string[]> };
  zipBudgetBytes: number;
  zipBudgetReason: string;
}
export function parseCsp(csp: string | undefined): Record<string, string[]>;
export function requestedBy(
  manifest: Record<string, unknown>,
): Omit<
  PermissionAllowlist,
  "content_security_policy" | "zipBudgetBytes" | "zipBudgetReason"
>;
export function checkAgainstAllowlist(
  manifest: Record<string, unknown>,
  allowlist: PermissionAllowlist,
  apiHost: string,
  label: string,
): string[];
