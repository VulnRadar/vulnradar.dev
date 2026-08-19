import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { getSetting } from "@/lib/config/runtime-config";
import { setDiscoveryStage } from "@/lib/scanner/discovery-progress";
import { extractRootDomain } from "@/lib/scanner/root-domain";
import {
  getCachedSubdomains,
  discoverSubdomainsForRoot,
} from "@/lib/scanner/subdomain-discovery-engine";

// Subdomain discovery is a scan-adjacent recon pass (passive CT-log /
// passive-DNS sources + a common-prefix DNS brute-force + reachability
// probing). The heavy pipeline and its per-domain cache live in
// lib/scanner/subdomain-discovery-engine.ts so the automatic in-scan capture
// (lib/scanner/subdomain-auto.ts) reuses the exact same engine and cache.
// This route is only the request boundary: auth, rate limiting, input
// validation, the SSRF guard, and the cache-hit fast path.

export async function POST(request: NextRequest) {
  try {
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

    const rootDomain = extractRootDomain(domain);

    // Check if force refresh is requested
    const forceRefresh = body.forceRefresh === true;

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
