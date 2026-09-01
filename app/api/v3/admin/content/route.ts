import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getClientIp } from "@/lib/api/request-utils";
import { requirePermission, logAction } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import {
  CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
  CONFIG_PAGINATION_MAX_PAGE_SIZE,
} from "@/lib/config/config-values";

// Content moderation (purge cached host reputation, unlist/revoke public
// shares) -- gated by MODERATE_CONTENT so the content_manager and
// security_analyst specialist roles reach it, not just admin.
async function requireAdmin() {
  return requirePermission(STAFF_PERMISSIONS.MODERATE_CONTENT);
}

function parsePagination(searchParams: URLSearchParams) {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const requestedLimit = parseInt(
    searchParams.get("limit") || String(CONFIG_PAGINATION_DEFAULT_PAGE_SIZE),
    10,
  );
  const limit = Math.min(
    CONFIG_PAGINATION_MAX_PAGE_SIZE,
    Math.max(1, requestedLimit || CONFIG_PAGINATION_DEFAULT_PAGE_SIZE),
  );
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * GET /api/v3/admin/content?type=hosts|shares
 *
 * Browsable listings behind the two "delete by exact value" actions this
 * file's POST handler already had (purge_host, unlist_share, revoke_share) --
 * finding something to act on previously required already knowing its exact
 * host or scan id. type=hosts lists host_reputation (the public /host/
 * [hostname] cache); type=shares lists scan_history rows that have ever had
 * a share link (share_token IS NOT NULL), independent of whether that link
 * is still live or publicly listed -- see share_publicly_listed's own
 * instrumentation.ts comment for why that flag is a separate concept from
 * scan_history.is_public (the host_reputation feed, "hosts" above).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAdmin();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const { page, limit, offset } = parsePagination(searchParams);

    if (type === "hosts") {
      // perf: COUNT(*) scans the whole table whatever the sibling LIMIT is,
      // so awaiting it before the page query doubled the wall time of every
      // page load for no reason. The two are independent.
      const [countRes, rowsRes] = await Promise.all([
        pool.query<{ count: string }>(`SELECT COUNT(*) FROM host_reputation`),
        pool.query(
          `SELECT host, danger_score, severity_counts, last_scanned_at, source_scan_id, auto_tags
           FROM host_reputation
           ORDER BY last_scanned_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
      ]);
      const total = parseInt(countRes.rows[0]?.count || "0", 10);
      return NextResponse.json({
        hosts: rowsRes.rows,
        page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        total,
      });
    }

    if (type === "shares") {
      // See the hosts branch above: count and page run together.
      const [countRes, rowsRes] = await Promise.all([
        pool.query<{ count: string }>(
          `SELECT COUNT(*) FROM scan_history WHERE share_token IS NOT NULL`,
        ),
        pool.query(
          `SELECT sh.id, sh.url, sh.scanned_at, sh.findings_count,
                sh.share_publicly_listed, sh.share_expires_at,
                u.email as user_email
           FROM scan_history sh
           LEFT JOIN users u ON sh.user_id = u.id
          WHERE sh.share_token IS NOT NULL
          ORDER BY sh.scanned_at DESC
          LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
      ]);
      const total = parseInt(countRes.rows[0]?.count || "0", 10);
      return NextResponse.json({
        shares: rowsRes.rows,
        page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        total,
      });
    }

    return NextResponse.json(
      { error: "type must be 'hosts' or 'shares'" },
      { status: 400 },
    );
  } catch (error) {
    console.error("[Admin Content] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = await getClientIp();
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "purge_host": {
        const host = String(body.host || "")
          .trim()
          .toLowerCase();
        if (!host) {
          return NextResponse.json({ error: "Missing host" }, { status: 400 });
        }
        const result = await pool.query(
          `DELETE FROM host_reputation WHERE host = $1 RETURNING host`,
          [host],
        );
        const deleted = (result.rowCount ?? 0) > 0;
        await logAction(
          user.id,
          null,
          "purge_host_reputation",
          `Purged cached host reputation for "${host}".`,
          ip,
        );
        return NextResponse.json({ success: true, deleted, host });
      }

      // Removes the scan from the public directory (app/public-scans) while
      // leaving the share link itself live -- someone with the link can
      // still open it, it just stops appearing in the browsable list.
      case "unlist_share": {
        const scanId = Number(body.scanId);
        if (!Number.isInteger(scanId)) {
          return NextResponse.json(
            { error: "Missing scanId" },
            { status: 400 },
          );
        }
        const result = await pool.query(
          `UPDATE scan_history SET share_publicly_listed = false
             WHERE id = $1 AND share_token IS NOT NULL
             RETURNING id, url`,
          [scanId],
        );
        const row = result.rows[0];
        if (!row) {
          return NextResponse.json(
            { error: "Share not found" },
            { status: 404 },
          );
        }
        await logAction(
          user.id,
          null,
          "unlist_public_share",
          `Removed scan #${scanId} (${row.url}) from the public scans directory.`,
          ip,
        );
        return NextResponse.json({ success: true });
      }

      // Fully revokes the link: anyone holding the URL gets the same
      // "not found" GET /api/v3/shared/[token] already returns for an
      // expired share -- share_token is cleared, not just the listing flag.
      case "revoke_share": {
        const scanId = Number(body.scanId);
        if (!Number.isInteger(scanId)) {
          return NextResponse.json(
            { error: "Missing scanId" },
            { status: 400 },
          );
        }
        const result = await pool.query(
          `UPDATE scan_history
             SET share_token = NULL, share_publicly_listed = false, share_expires_at = NULL
             WHERE id = $1 AND share_token IS NOT NULL
             RETURNING id, url`,
          [scanId],
        );
        const row = result.rows[0];
        if (!row) {
          return NextResponse.json(
            { error: "Share not found" },
            { status: 404 },
          );
        }
        await logAction(
          user.id,
          null,
          "revoke_public_share",
          `Revoked the share link for scan #${scanId} (${row.url}).`,
          ip,
        );
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Admin Content] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
