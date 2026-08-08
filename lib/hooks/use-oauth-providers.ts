"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/config/client-constants";

export interface OAuthProvidersConfig {
  google: boolean;
  github: boolean;
  discord: boolean;
}

const DEFAULT_CONFIG: OAuthProvidersConfig = {
  google: false,
  github: false,
  discord: false,
};

/**
 * Fetches which OAuth sign-up/sign-in providers are configured (their
 * client id + secret env vars are set), same "tell the client what's
 * configured" shape as /api/v3/ai/info. Used by both the login and signup
 * forms to decide which provider buttons to render -- every provider
 * starts hidden until this resolves, and stays hidden if the request
 * fails, so an unconfigured or unreachable provider never shows a button
 * that would just error out.
 */
export function useOAuthProviders(): OAuthProvidersConfig {
  const [config, setConfig] = useState<OAuthProvidersConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    fetch(API.AUTH.OAUTH_INFO)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setConfig({
            google: Boolean(data.google),
            github: Boolean(data.github),
            discord: Boolean(data.discord),
          });
        }
      })
      .catch(() => {
        /* stay hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
