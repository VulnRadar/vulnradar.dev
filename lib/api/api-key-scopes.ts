import {
  API_KEY_SCOPES,
  ALL_API_KEY_SCOPES,
  resolveApiKeyScopes,
  type ApiKeyScope,
} from "@/lib/config/client-constants";

/**
 * Server-side API key scope check. Deliberately its own module, separate
 * from lib/api/api-keys.ts: every route test in this codebase mocks
 * `@/lib/api/api-keys` wholesale (see tests/app/api/v3/**\/route.test.ts),
 * so a pure helper defined there would silently become `undefined` in every
 * one of those suites. Living here instead means routes import the real
 * implementation everywhere, tests included, with nothing to remember to
 * re-mock.
 */
export { API_KEY_SCOPES, ALL_API_KEY_SCOPES, resolveApiKeyScopes };
export type { ApiKeyScope };

/**
 * True if `scopes` (a KeyValidationResult.scopes value, or any value shaped
 * like one) grants `required`. A non-array value -- most commonly a
 * pre-scoping key's NULL column, but also whatever an older test mock or a
 * caller that predates this feature happens to pass -- resolves to full
 * access via resolveApiKeyScopes, so this never turns into an unintended
 * lockout.
 */
export function hasApiKeyScope(
  scopes: unknown,
  required: ApiKeyScope,
): boolean {
  return resolveApiKeyScopes(scopes).includes(required);
}

/**
 * A 403 body naming the specific scope that was missing, not a generic
 * "unauthorized" -- so a CI pipeline's key rejection is actionable without
 * a support ticket.
 */
export function apiKeyScopeErrorMessage(required: ApiKeyScope): string {
  return `This API key is missing the "${required}" scope required for this action. Grant it from Profile -> Developer -> API Keys, or use a key that already has it.`;
}
