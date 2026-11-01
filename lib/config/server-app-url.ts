// SERVER APP URL
//
//   serverAppUrl() = saved APP_URL setting ?? APP_URL ?? NEXT_PUBLIC_APP_URL
//                    (both as the running process sees them) ?? CONFIG_APP_URL
//
// Next.js replaces every `process.env.NEXT_PUBLIC_*` it can see with the value
// it had at `next build`, in server bundles as well as browser ones. The
// published image is built with the upstream origin, so on a self-hosted
// instance the APP_URL export in client-constants.ts is https://vulnradar.dev
// whatever the container is started with, and a password-reset or
// verification link built from it hands a live token to a domain the operator
// does not own. Reading the variable by a name held in an array is something
// the build cannot rewrite, so this sees the container's environment.
//
// Server only: it reads the settings table through runtime-config.

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
 * This deployment's public origin, for any link the server builds: emails,
 * invites, redirects. `fallback` is used only when neither the settings table
 * nor the environment has one.
 */
export async function serverAppUrl(
  fallback: string = CONFIG_APP_URL,
): Promise<string> {
  const stored = await getStoredSetting("APP_URL");
  if (stored) return withoutTrailingSlash(stored);
  return runtimeEnvAppUrl() ?? withoutTrailingSlash(fallback);
}
