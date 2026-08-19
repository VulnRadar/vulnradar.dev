import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { BEARER_PREFIX } from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import { discoverPages } from "@/lib/scanner/crawl-discovery";

export async function POST(request: NextRequest) {
  // Allow either session-based auth or API key (Bearer)
  let userId: number | null = null;
  let _isApiKeyAuth = false;

  const session = await getSession();
  if (session) {
    userId = session.userId;
  } else {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith(BEARER_PREFIX)) {
      const token = authHeader.slice(BEARER_PREFIX.length);
      const keyData = await validateApiKey(token);
      if (!keyData) {
        return NextResponse.json(
          { error: "Invalid or revoked API key." },
          { status: 401 },
        );
      }
      if (keyData.needsTermsAcceptance) {
        return NextResponse.json(
          {
            error:
              "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
          },
          { status: 403 },
        );
      }
      // scoping: crawling a site to discover pages is scan-triggering work,
      // so it requires scan:write.
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
    key: `crawl-discover:${userId}`,
    ...RATE_LIMITS.scan,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Please wait before trying again." },
      { status: 429 },
    );
  }

  const { url } = await request.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }
  // scanner: per-URL length cap shared with scan/route.ts.
  const {
    MAX_URL_LENGTH: maxUrlLength,
    CRAWL_DISCOVER_MAX_PAGES: maxPages,
    CRAWL_DISCOVER_FETCH_TIMEOUT_MS: fetchTimeoutMs,
    CRAWL_DISCOVER_BODY_MAX_BYTES: maxBodySize,
  } = await getSettings([
    "MAX_URL_LENGTH",
    "CRAWL_DISCOVER_MAX_PAGES",
    "CRAWL_DISCOVER_FETCH_TIMEOUT_MS",
    "CRAWL_DISCOVER_BODY_MAX_BYTES",
  ] as const);
  if (url.length > maxUrlLength) {
    return NextResponse.json(
      {
        error: `URL exceeds maximum length of ${maxUrlLength} characters.`,
      },
      { status: 400 },
    );
  }

  let startUrl: URL;
  try {
    startUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (startUrl.protocol !== "http:" && startUrl.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only http and https URLs are allowed" },
      { status: 400 },
    );
  }

  // Same-origin, SSRF-safe discovery: sitemap URLs (index + robots directive)
  // plus a depth-bounded link crawl, all pinned to the entry hostname so no
  // subdomain or cross-host URL can ever enter the list. Shared with the crawl
  // scan job so the picker surfaces exactly the pages a scan would cover.
  const urls = await discoverPages(startUrl.href, {
    maxPages,
    fetchTimeoutMs,
    maxBodySize,
  });

  return NextResponse.json({ urls });
}
