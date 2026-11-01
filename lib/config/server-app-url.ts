// SERVER APP URL
//
//   serverAppUrl()     = saved APP_URL setting ?? APP_URL ?? NEXT_PUBLIC_APP_URL
//                        (both as the running process sees them) ?? CONFIG_APP_URL
//   secretLinkAppUrl() = APP_URL ?? NEXT_PUBLIC_APP_URL ?? CONFIG_APP_URL
//
// Next.js replaces every `process.env.NEXT_PUBLIC_*` it can see with the value
// it had at `next build`, in server bundles as well as browser ones. The
// published image is built with the upstream origin, so on a self-hosted
// instance the APP_URL export in client-constants.ts is https://vulnradar.dev
// whatever the container is started with, and a password-reset or
// verification link built from it hands a live token to a domain the operator
// does not own. Reading the variable by a name held in an array is something
// the build cannot rewrite, so both readers see the container's environment.
//
// There are two because the saved row and the environment are changed in
// different places. Only the super admin can save the row, from the settings
// page in a browser session; only whoever runs the process can set the
// environment. The row feeds serverAppUrl(), and through resolveAppUrl() the
// GitHub, Google and Discord sign-in and connect redirects and staff SSO,
// where the provider checks the redirect_uri against the URIs registered with
// it. A link that carries a secret reads only the environment, through
// secretLinkAppUrl(): if it followed the row, one browser session could save
// a domain it owns, ask the public forgot-password endpoint for any address,
// and read the token off the request when the link is clicked.
//
// Server only: serverAppUrl() reads the settings table through runtime-config.

import { CONFIG_APP_URL } from "@/lib/config/config-values";
import { coerceSettingValue } from "@/lib/config/registry";
import { getStoredSetting } from "@/lib/config/runtime-config";

// APP_URL first: it is the server-side name, so an operator who sets it means
// it to win over a NEXT_PUBLIC_APP_URL left over from the build.
const RUNTIME_ENV_NAMES = ["APP_URL", "NEXT_PUBLIC_APP_URL"];

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * The app URL from the process environment at the moment of the call, or
 * undefined when neither variable holds a valid URL.
 */
export function runtimeEnvAppUrl(): string | undefined {
  for (const name of RUNTIME_ENV_NAMES) {
    const url = coerceSettingValue("APP_URL", process.env[name]);
    if (url) return withoutTrailingSlash(url);
  }
  return undefined;
}

/**
 * The origin for a link that carries a secret, or that sends the reader to
 * type one: password reset, email verification, staff and team invites,
 * unsubscribe, and the sign-in page a duplicate-signup notice points at.
 *
 * The environment the process was started with, then the shipped default.
 * Never the saved setting: only the super admin can save it, from a browser,
 * and it feeds only the OAuth and staff sign-in redirects.
 */
export function secretLinkAppUrl(): string {
  return runtimeEnvAppUrl() ?? withoutTrailingSlash(CONFIG_APP_URL);
}

/**
 * This deployment's public origin for a link that carries no secret. Today
 * that is only the OAuth and staff sign-in redirect_uri, through
 * resolveAppUrl(). `fallback` is used only when neither the settings table
 * nor the environment has one. A link with a token in it uses
 * secretLinkAppUrl() instead.
 */
export async function serverAppUrl(
  fallback: string = CONFIG_APP_URL,
): Promise<string> {
  const stored = await getStoredSetting("APP_URL");
  if (stored) return withoutTrailingSlash(stored);
  return runtimeEnvAppUrl() ?? withoutTrailingSlash(fallback);
}
