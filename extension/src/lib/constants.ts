export const VULNRADAR = {
  /** API host (matches CONFIG_APP_URL in main repo). */
  apiHost: "https://sandbox.vulnradar.dev",
  /** API key prefix - users paste `vr_live_xxxx`. Matches CONFIG_API_KEY_PREFIX. */
  apiKeyPrefix: "vr_live_",
  /** Brand display name. */
  appName: "VulnRadar",
  /** Primary brand color (matches --primary hsl(190 90% 42%) from globals.css). */
  brandColor: "#0babcc",
  /** Extension version (mirrors package.json). */
  version: "0.1.0",
  /** Storage keys (namespaced to avoid collisions). */
  storageKeys: {
    auth: "vulnradar_ext.auth",
    settings: "vulnradar_ext.settings",
    historyCache: "vulnradar_ext.history_cache",
    apiKey: "vulnradar_ext.api_key",
  },
  /** API key format validation regex. */
  apiKeyPattern: /^vr_live_[a-f0-9]{64}$/,
  /** Per-request timeout when calling the VulnRadar API. */
  apiTimeoutMs: 30_000,
  /** Max history rows cached locally. */
  historyCacheSize: 20,
  /** Min time between reputation lookups for the same host - keeps repeat
   *  navigations within a site from spamming GET /scan/reputation. */
  reputationThrottleMs: 10 * 60 * 1000,
} as const;
