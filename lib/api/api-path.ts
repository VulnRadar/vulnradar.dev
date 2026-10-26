import {
  CONFIG_API_INTERNAL_PREFIX,
  CONFIG_API_VERSION,
} from "../config/config-values";

function withLeadingSlash(path: string): string {
  return path === "" || path.startsWith("/") ? path : `/${path}`;
}

/**
 * A path under the version this server advertises, for documentation, code
 * samples and default base URLs. It follows CONFIG_API_VERSION, so a sample
 * written with it moves when the advertised version does.
 *
 * It is not for the web app's own calls: those use the API map in
 * client-constants.ts, which also knows which space an endpoint lives in.
 */
export function apiPath(path: string): string {
  return `/api/${CONFIG_API_VERSION}${withLeadingSlash(path)}`;
}

/** A path under the web app's own routes. No contract: never put one in a sample for third parties. */
export function internalPath(path: string): string {
  return `${CONFIG_API_INTERNAL_PREFIX}${withLeadingSlash(path)}`;
}
