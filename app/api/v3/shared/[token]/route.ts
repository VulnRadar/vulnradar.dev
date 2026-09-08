import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import pool from "@/lib/database/db";
import { withErrorHandling } from "@/lib/api/api-utils";
import { getCachedSubdomainSnapshot } from "@/lib/scanner/subdomain-cache";

/**
 * The result_meta keys a share link is allowed to publish, spelled out
 * because a spread is not an allowlist.
 *
 * Anyone holding the token reads this response, and `...meta` handed them
 * every key result_meta happened to carry. Three of those are not part of
 * the report: `crawl.pages[].scanHistoryId` (internal primary keys of the
 * owner's other scan rows, which the crawl panel never reads), `authReport`
 * (the login outcome of an authenticated run, which nothing on the shared
 * page renders), and `checksErrored` (an operator signal that a detector
 * threw). A key added to result_meta later would have joined them
 * automatically. This is the same fix already applied to the anonymous host
 * report at app/api/v3/host/[hostname]/route.ts.
 *
 * `redirect` and `crawl` are handled separately below: both are rendered by
 * the page, and both need more than a copy.
 */
const PUBLIC_META_KEYS = [
  "checksRun",
  "dangerScore",
  "engineConfidence",
  "incomplete",
  "aiSummary",
  "sslGrade",
  "siteGrade",
  "threatIntel",
  "softwareInventory",
  "dnsRecords",
  "portScan",
  "subdomains",
  "screenshot",
] as const;

/**
 * The crawl summary minus the per-page `scanHistoryId`.
 *
 * components/scanner/crawl-pages-info.tsx declares the five fields it reads
 * (url, findings, findings_count, summary, duration) and scanHistoryId is
 * not among them: it rode along only because the whole object was spread.
 * Rebuilt by name for the same reason PUBLIC_META_KEYS exists, so a field
 * added to the crawl record at scan time is not published by default.
 */
function publicCrawl(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const crawl = raw as Record<string, unknown>;
  const pages = Array.isArray(crawl.pages) ? crawl.pages : [];
  return {
    pagesDiscovered: crawl.pagesDiscovered,
    pagesScanned: crawl.pagesScanned,
    pagesSkipped: crawl.pagesSkipped,
    pages: pages.map((entry) => {
      const page = (entry ?? {}) as Record<string, unknown>;
      return {
        url: page.url,
        findings: page.findings ?? [],
        findings_count: page.findings_count ?? 0,
        summary: page.summary ?? {},
        duration: page.duration ?? 0,
      };
    }),
  };
}

export const GET = withErrorHandling(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ token: string }> },
  ) => {
    const { token } = await params;

    if (!token || token.length !== 64) {
      return NextResponse.json(
        { error: "Invalid share link" },
        { status: 400 },
      );
    }

    // Look up by SHA-256 hash so the plaintext token is never compared
    // directly in the DB (AUDIT-004#secrets-01). The hash is stored in
    // the generated column share_token_hash (added in migration 3.1.0).
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // An expired link (share_expires_at in the past) is excluded from the
    // lookup entirely, the same as a revoked one -- never even fetched, let
    // alone returned, so there's no path where an expired link's findings
    // briefly reach the response.
    let result = await pool.query(
      `SELECT sh.id, sh.url, sh.summary, sh.findings, sh.findings_count, sh.duration, sh.scanned_at, sh.response_headers, sh.notes, sh.user_id, sh.result_meta, sh.authenticated, u.name as scanned_by, u.avatar_url as scanned_by_avatar, u.role as scanned_by_role
     FROM scan_history sh
     JOIN users u ON sh.user_id = u.id
     WHERE sh.share_token_hash = $1
       AND (sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())`,
      [tokenHash],
    );

    // Not a per-scan snapshot token -- try the auto-updating host_badges
    // token (app/api/v3/badge/site/route.ts), so clicking through the
    // badge image always lands on the SAME latest-by-date scan the image
    // itself rendered, same fallback app/api/v3/badge/[token]/route.ts uses.
    // Scoped to the badge owner's own scans unless they've opted into
    // hb.scope = 'global' (PATCH on that same route), in which case this
    // can resolve to a scan someone else ran -- but ONLY one that scan's
    // owner marked public (sh.is_public = true). Without that gate,
    // 'global' would let anyone pull a stranger's PRIVATE or authenticated
    // scan (full findings, headers, notes) just by pointing a badge at
    // that URL, bypassing is_public the way every other privacy-gated path
    // in this codebase (getExactUrlReputation, etc) requires it. The
    // owner's own scans still match regardless of is_public, same as
    // before. hb.user_id is selected alongside so a foreign-but-public
    // scan can still be detected and have its notes/identity redacted
    // below -- is_public only ever governs whether findings are visible
    // at all, not whether the scanning user's private notes are.
    if (result.rows.length === 0) {
      result = await pool.query(
        `SELECT sh.id, sh.url, sh.summary, sh.findings, sh.findings_count, sh.duration, sh.scanned_at, sh.response_headers, sh.notes, sh.user_id, sh.result_meta, sh.authenticated, u.name as scanned_by, u.avatar_url as scanned_by_avatar, u.role as scanned_by_role, hb.user_id as badge_owner_id
       FROM host_badges hb
       JOIN scan_history sh ON sh.url = hb.url
         AND (sh.user_id = hb.user_id OR (hb.scope = 'global' AND sh.is_public = true))
       JOIN users u ON sh.user_id = u.id
       WHERE hb.badge_token_hash = $1
         AND hb.revoked_at IS NULL
         AND sh.status = 'completed'
       ORDER BY sh.scanned_at DESC
       LIMIT 1`,
        [tokenHash],
      );
    }

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Shared scan not found or link has been revoked" },
        { status: 404 },
      );
    }

    const row = result.rows[0];
    // A 'global' badge can resolve to a scan someone other than the badge
    // owner ran. That person never consented to being identified or having
    // their private notes exposed just because a stranger's badge happened
    // to pick up their scan -- only the aggregate findings (already the
    // point of the badge) are shown for a foreign scan; notes and identity
    // are redacted the same way an anonymous share link redacts nothing
    // for the owner but this isn't the owner's link to begin with.
    const isForeignScan =
      row.badge_owner_id != null && row.user_id !== row.badge_owner_id;
    // checksRun, dangerScore, engineConfidence, incomplete and (for crawl
    // scans) crawl all live in here -- same source app/api/v3/history/[id]/route.ts
    // reads it from, kept in parity so a shared scan shows the same detail
    // an owner sees on their own history/dashboard pages. Republished by
    // name, never spread: see PUBLIC_META_KEYS.
    const meta: Record<string, unknown> = row.result_meta || {};
    const publicMeta: Record<string, unknown> = {};
    for (const key of PUBLIC_META_KEYS) {
      if (meta[key] !== undefined) publicMeta[key] = meta[key];
    }
    // `redirect` holds { requestedUrl, finalUrl } verbatim, and scan-jobs.ts
    // rewrites scan_history.url to the redirect target, so requestedUrl is
    // the only surviving copy of what was actually submitted: scan
    // https://app.example.com/invite?token=SECRET, let it bounce to /login,
    // and the token lives here. The owner's own share link keeps it, because
    // components/scanner/scan-result-detail.tsx renders that warning and the
    // owner saw it on their own report before choosing to share. A foreign
    // scan pulled in by a global-scope badge does not: its owner never
    // consented to a stranger's badge republishing the URL they typed, the
    // same reason their notes and identity are redacted above.
    if (!isForeignScan && meta.redirect !== undefined) {
      publicMeta.redirect = meta.redirect;
    }
    const crawl = publicCrawl(meta.crawl);
    if (crawl) publicMeta.crawl = crawl;

    // Get user badges and any already-cached subdomain-discovery snapshot
    // for this scan's host in parallel -- independent reads. The cache
    // lookup is read-only and never triggers a new discovery job: an
    // anonymous viewer of a shared link has no session or API key to
    // authenticate POST /api/v3/scan/discover with, and it isn't their
    // scan to spend rate-limit budget on (see
    // components/scanner/subdomain-discovery.tsx's readOnly mode).
    // Tags (auto and user, see lib/tags/auto-tags.ts and
    // app/api/v3/scan/tags/route.ts) are shown to anyone viewing a shared
    // link, same as notes already are -- sharing the scan at all already
    // exposes its findings, so there's no additional exposure in also
    // showing the tags derived from (or added alongside) those findings.
    // Skip the platform-badges lookup entirely for a foreign scan -- those
    // badges (Verified, Pro, etc.) would tangentially identify the other
    // user too, and there's no reason to even run the query for a value
    // the response is about to redact anyway.
    const [badgesResult, subdomainCache, tagsResult] = await Promise.all([
      isForeignScan
        ? Promise.resolve({ rows: [] })
        : pool.query(
            `SELECT b.id, b.name, b.display_name, b.icon, b.color, b.priority
       FROM user_badges ub JOIN badges b ON ub.badge_id = b.id
       WHERE ub.user_id = $1 ORDER BY b.priority DESC`,
            [row.user_id],
          ),
      getCachedSubdomainSnapshot(row.url),
      pool.query(
        `SELECT tag, source FROM scan_tags WHERE scan_id = $1 ORDER BY source, tag`,
        [row.id],
      ),
    ]);

    return NextResponse.json({
      scanId: row.id,
      url: row.url,
      scannedAt: row.scanned_at,
      duration: row.duration,
      summary: row.summary,
      findings: row.findings || [],
      responseHeaders: row.response_headers || undefined,
      notes: isForeignScan ? "" : row.notes || "",
      authenticated: row.authenticated || false,
      scannedBy: isForeignScan
        ? "Community scan"
        : row.scanned_by || "Anonymous",
      scannedByAvatar: isForeignScan ? null : row.scanned_by_avatar || null,
      scannedByRole: isForeignScan ? "user" : row.scanned_by_role || "user",
      scannedByBadges: badgesResult.rows,
      subdomainCache,
      tags: tagsResult.rows,
      ...publicMeta,
    });
  },
);
