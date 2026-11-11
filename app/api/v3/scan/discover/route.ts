import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseBearer } from "@/lib/api/bearer";
import { authenticateApiKey } from "@/lib/api/api-key-auth";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { readJsonObject, withErrorHandling } from "@/lib/api/api-utils";
import {
  burstLimitedResponse,
  rateLimitedResponse,
} from "@/lib/api/rate-limit-response";
import { versioned } from "@/lib/api/v4/wrap";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  getDailyLimit,
  incrementDailyCountCapped,
} from "@/lib/rate-limiting/daily-limits";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import { requireRefreshPlan } from "@/lib/history/refresh-scan";
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

async function handler(request: NextRequest) {
  try {
    // PAUSE_SCANNING (and MAINTENANCE_MODE, which implies it). Discovery is
    // recon rather than a stored scan, but it is live outbound traffic
    // against a third party's DNS and hosts, which is the thing a pause is
    // meant to stop.
    const paused = await scanningPausedResponse();
    if (paused) return paused;

    let userId: number;

    // Try session auth first
    const session = await getSession();
    if (session) {
      userId = session.userId;
    } else if (parseBearer(request.headers.get("authorization")) !== null) {
      // scoping: subdomain discovery is scan-triggering work (external
      // lookups + a scan-adjacent recon pass), so it requires scan:write.
      const key = await authenticateApiKey(request, {
        scope: API_KEY_SCOPES.SCAN_WRITE,
      });
      if (!key.ok) return key.response;
      userId = key.auth.userId;
    } else {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await checkRateLimit({
      key: `discover:${userId}`,
      ...RATE_LIMITS.scan,
    });
    if (!rl.allowed) {
      return burstLimitedResponse(
        rl,
        "Rate limit reached. Please wait before discovering again.",
      );
    }

    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const { url } = body;
    // The token the caller polls GET /scan/discover/progress/{token} with.
    // `requestId` is its v3 name, which v4 also uses for the correlation id
    // of every response, so `progressToken` is accepted as the same field.
    const requestId: string | undefined =
      typeof body.progressToken === "string"
        ? body.progressToken
        : typeof body.requestId === "string"
          ? body.requestId
          : undefined;

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

    // billing: what is charged here is the forced refresh, and only that. It
    // skips the cache and runs the full discovery engine: a 191-prefix DNS
    // brute force, DNS resolution of up to 1000 passive entries, and HTTP
    // reachability probing.
    //
    // A cache miss without forceRefresh runs that same engine and is NOT
    // charged or plan-gated. It happens on the first discovery of a root
    // domain and again each time its cache entry expires, so what bounds it
    // is the hourly limiter above plus the per-domain cache, not the daily
    // quota. Charging every engine run is a billing change and was left out
    // of 4.0.0 on purpose. Only a cache hit is genuinely free of outbound
    // work.
    if (forceRefresh) {
      // billing: the plan gate, which lived only in the browser.
      //
      // components/scanner/subdomain-discovery.tsx refuses the click below
      // pro_supporter and premium-upgrade-modal.tsx declares it as such, but
      // this route imported no plan module at all: a direct POST, or any API
      // key with scan:write, forced a fresh run on a free account whenever it
      // liked, cache or not.
      //
      // Gated HERE rather than at the top of the route, deliberately: a free
      // account keeps both the cached result and the uncharged first run
      // described above, and loses only the forced re-run, which is the line
      // the daily charge below is drawn on too.
      //
      // requireRefreshPlan is the same helper the three sibling refresh routes
      // use (history/[id]/dns, ports, screenshot) and resolves to the same
      // pro_supporter minimum, so all four premium re-runs now answer
      // identically instead of this one being the exception.
      const planCheck = await requireRefreshPlan(userId);
      if (!planCheck.ok) return planCheck.response;

      const dailyLimit = await getDailyLimit(userId);
      const charge = await incrementDailyCountCapped(userId, dailyLimit);
      if (!charge.recorded) {
        return rateLimitedResponse(
          {
            limit: dailyLimit,
            used: charge.count,
            remaining: 0,
            resetsAt: nextUtcMidnight(),
          },
          "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
          { code: "DAILY_LIMIT" },
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

/** The daily quota's reset, the same instant canMakeRequest reports. */
function nextUtcMidnight(): string {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next.toISOString();
}

export const POST = versioned("scan.discover", withErrorHandling(handler));
