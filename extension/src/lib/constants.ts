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
  /** Per-request timeout for quick calls (auth, history, reputation). */
  apiTimeoutMs: 30_000,
  /**
   * Timeout for a single-URL scan request. /api/v3/scan holds the HTTP
   * connection open for the whole scan and only responds once it's done --
   * the server's own watchdog (SCAN_TIMEOUT_SECONDS, default 300s, see
   * lib/scanner/execute-scan.ts) allows a legitimate scan up to 5 minutes.
   * This must stay comfortably above that or the extension aborts the
   * request client-side on a slow-but-successful scan, which still
   * finishes and lands in history -- exactly the "scan failed" report
   * for a scan that's actually sitting right there in history.
   */
  scanTimeoutMs: 310_000,
  /**
   * Timeout for a crawl (deep mode) scan request, same reasoning as
   * scanTimeoutMs but matching CRAWL_SCAN_TIMEOUT_SECONDS (default 900s,
   * see lib/scanner/execute-crawl-scan.ts) since a multi-page crawl is
   * allowed much longer.
   */
  crawlTimeoutMs: 910_000,
  /** Max history rows cached locally. */
  historyCacheSize: 20,
  /** Min time between reputation lookups for the same host - keeps repeat
   *  navigations within a site from spamming GET /scan/reputation. */
  reputationThrottleMs: 10 * 60 * 1000,
  /** How recently a background-run manual scan must have finished for a
   *  reopened popup to treat it as "just completed" (fresh result, not
   *  stale) instead of falling back to the generic cached lastResult. */
  recentScanCompletionWindowMs: 60_000,
  /** Bound on browser.tabs.sendMessage via lib/messaging.ts's sendTabMessage.
   *  A long-backgrounded Firefox tab's message port can go unanswered
   *  forever with no rejection - see messaging.ts's doc comment. */
  tabMessageTimeoutMs: 4_000,
} as const;
