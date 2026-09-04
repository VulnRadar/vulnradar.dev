import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  getDailyLimit,
  incrementDailyCountCapped,
} from "@/lib/rate-limiting/daily-limits";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { getSetting } from "@/lib/config/runtime-config";
import { setDiscoveryStage } from "@/lib/scanner/discovery-progress";
import { extractRootDomain } from "@/lib/scanner/root-domain";
import {
  getCachedSubdomains,
  discoverSubdomainsForRoot,
} from "@/lib/scanner/subdomain-discovery-engine";
import { scanningPausedResponse } from "@/lib/admin/service-state";

// Subdomain discovery is a scan-adjacent recon pass (passive CT-log /
// passive-DNS sources + a common-prefix DNS brute-force + reachability
// probing). The heavy pipeline and its per-domain cache live in
// lib/scanner/subdomain-discovery-engine.ts so the automatic in-scan capture
// (lib/scanner/subdomain-auto.ts) reuses the exact same engine and cache.
// This route is only the request boundary: auth, rate limiting, input
// validation, the SSRF guard, and the cache-hit fast path.

export async function POST(request: NextRequest) {
  try {
    // PAUSE_SCANNING (and MAINTENANCE_MODE, which implies it). Discovery is
    // recon rather than a stored scan, but it is live outbound traffic
    // against a third party's DNS and hosts, which is the thing a pause is
    // meant to stop.
    const paused = await scanningPausedResponse();
    if (paused) return paused;

    let userId: number | null = null;
    let _isApiKeyAuth = false;

    // Try session auth first
    const session = await getSession();
    if (session) {
      userId = session.userId;
    } else {
      // Try API key auth
      const authHeader = request.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const apiKey = authHeader.slice(7);
        const keyData = await validateApiKey(apiKey);
        if (!keyData) {
          return NextResponse.json(
            { error: "Invalid or revoked API key." },
            { status: 401 },
          );
        }

        // Check if user needs to accept updated terms
        if (keyData.needsTermsAcceptance) {
          return NextResponse.json(
            {
              error:
                "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
            },
            { status: 403 },
          );
        }

        // scoping: subdomain discovery is scan-triggering work (external
        // lookups + a scan-adjacent recon pass), so it requires scan:write.
        if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_WRITE)) {
          return NextResponse.json(
            { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_WRITE) },
            { status: 403 },
          );
        }

        userId = keyData.userId;
      } else {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const rl = await checkRateLimit({
      key: `discover:${userId}`,
      ...RATE_LIMITS.scan,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit reached. Please wait before discovering again." },
        { status: 429 },
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
    const { url } = body;
    const requestId: string | undefined =
      typeof body.requestId === "string" ? body.requestId : undefined;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }
    // scanner: per-URL length cap shared with scan/route.ts.
    const maxUrlLength = await getSetting("MAX_URL_LENGTH");
    if (url.length > maxUrlLength) {
      return NextResponse.json(
        {
          error: `URL exceeds maximum length of ${maxUrlLength} characters.`,
        },
        { status: 400 },
      );
    }

    let domain: string;
    try {
      const parsed = new URL(url);
      domain = parsed.hostname;
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // ssrf: run the full SSRF guard against the user-supplied URL
    // BEFORE any external DNS or third-party-API lookup. Without
    // this, an attacker can submit `http://localhost/` or any
    // RFC1918 / link-local / cloud-metadata hostname and the
    // handler fires ~140 prefix DNS lookups plus crt.sh /
    // hackertarget / subdomain.center / rapiddns queries against
    // the operator's network. validateScanTarget rejects private /
    // loopback / link-local / metadata targets.
    const scanSafety = await validateScanTarget(url);
    if (!scanSafety.safe) {
      return NextResponse.json(
        {
          error: scanSafety.reason || "URL blocked for security reasons",
        },
        { status: 400 },
      );
    }

    // security: the admin blocklist applies to recon exactly as it does to a
    // scan. Discovery aims real outbound traffic at the target, so a
    // blocklisted host must not be reachable through this route either.
    const accessCheck = await checkAccessRules(url);
    if (!accessCheck.allowed) {
      return NextResponse.json(
        { error: accessCheck.reason || "Target blocked by access rules" },
        { status: 403 },
      );
    }

    const rootDomain = extractRootDomain(domain);

    // Check if force refresh is requested
    const forceRefresh = body.forceRefresh === true;

    // billing: a forced refresh skips the cache and runs the full discovery
    // engine, which is a 191-prefix DNS brute force plus DNS resolution of up
    // to 1000 passive entries plus HTTP reachability probing. That is a large
    // amount of compute and third-party egress, and it was charged to nobody:
    // the hourly rate limit above was the only bound, so one account could
    // aim roughly 200,000 DNS lookups a day at targets it does not own. A
    // cache hit stays free, since it does no outbound work.
    if (forceRefresh) {
      const dailyLimit = await getDailyLimit(userId);
      const charge = await incrementDailyCountCapped(userId, dailyLimit);
      if (!charge.recorded) {
        return NextResponse.json(
          {
            error:
              "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
          },
          { status: 429 },
        );
      }
    }

    // Check cache first (admin-configurable TTL) unless force refresh
    if (!forceRefresh) {
      const cached = await getCachedSubdomains(rootDomain);
      if (cached) {
        setDiscoveryStage(requestId, "done");
        return NextResponse.json({
          domain: rootDomain,
          subdomains: cached.subdomains,
          total: cached.subdomains.length,
          reachable: cached.subdomains.filter((s) => s.reachable).length,
          cached: true,
          cachedAt: cached.cachedAt,
          expiresAt: cached.expiresAt,
        });
      }
    }

    // Cache miss (or forced refresh): run the shared discovery engine, which
    // aggregates passive sources + DNS brute-force, filters by DNS, probes
    // reachability, writes the per-domain cache, and returns the result.
    const result = await discoverSubdomainsForRoot(rootDomain, { requestId });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Discover] Subdomain discovery error:", err);
    return NextResponse.json(
      { error: "Subdomain discovery failed" },
      { status: 500 },
    );
  }
}
