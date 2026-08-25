import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getClientIp } from "@/lib/api/request-utils";
import {
  requireAdmin as _requireAdmin,
  logAction,
} from "@/lib/auth/authorization";
import { normalizeHostForReputation } from "@/lib/scanner/host-reputation";

// Stays admin-only, unlike content/route.ts's MODERATE_CONTENT gate: the
// delete_scans action below bulk-deletes scan_history rows across every
// user matching a domain pattern, not just a single cached reputation
// row -- too broad a blast radius to hand to the content_manager/
// security_analyst specialist roles alongside the milder content actions.
async function requireAdmin() {
  return _requireAdmin();
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = await getClientIp();
    const body = await request.json();
    const { action, value } = body;

    if (!action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    switch (action) {
      case "find_scans": {
        if (!value) {
          return NextResponse.json({ error: "Missing value" }, { status: 400 });
        }

        // Normalize the domain (strip protocol if accidentally included)
        let normalizedValue = value.trim().toLowerCase();

        // Remove protocol using indexOf instead of regex
        const protoEnd = normalizedValue.indexOf("://");
        if (protoEnd !== -1) {
          normalizedValue = normalizedValue.substring(protoEnd + 3);
        }

        // Remove path using indexOf instead of regex
        const pathIndex = normalizedValue.indexOf("/");
        if (pathIndex !== -1) {
          normalizedValue = normalizedValue.substring(0, pathIndex);
        }

        // Find scans matching the blocked domain
        // Uses a subquery to extract hostname from URL and match:
        // - Exact domain match (example.com)
        // - Subdomain match (sub.example.com)
        // The regex extracts the hostname from URLs like http://example.com/path
        const result = await pool.query(
          `
          SELECT 
            sh.id,
            sh.url,
            sh.source,
            sh.scanned_at,
            sh.user_id,
            u.email as user_email
          FROM scan_history sh
          LEFT JOIN users u ON sh.user_id = u.id
          WHERE 
            -- Extract hostname from URL and check if it matches or is subdomain
            (
              -- Match domain exactly after stripping protocol
              LOWER(REGEXP_REPLACE(sh.url, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1')) = LOWER($1)
              -- Match subdomain (hostname ends with .domain)
              OR LOWER(REGEXP_REPLACE(sh.url, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1')) LIKE '%.' || LOWER($1)
            )
          ORDER BY sh.scanned_at DESC
          LIMIT 100
        `,
          [normalizedValue],
        );

        // Log the search action
        await logAction(
          user.id,
          null,
          "blocked_data_search",
          `Searched for scans matching blocked value: ${value} (found ${result.rows.length} results)`,
          ip,
        );

        return NextResponse.json({ scans: result.rows });
      }

      case "delete_scans": {
        if (!value) {
          return NextResponse.json({ error: "Missing value" }, { status: 400 });
        }

        // Normalize the domain
        let normalizedValue = value.trim().toLowerCase();

        // Remove protocol using indexOf instead of regex
        const protoEnd = normalizedValue.indexOf("://");
        if (protoEnd !== -1) {
          normalizedValue = normalizedValue.substring(protoEnd + 3);
        }

        // Remove path using indexOf instead of regex
        const pathIndex = normalizedValue.indexOf("/");
        if (pathIndex !== -1) {
          normalizedValue = normalizedValue.substring(0, pathIndex);
        }

        // Escape LIKE metacharacters in the subdomain pattern: an admin value
        // like "%.com" would otherwise expand its % into a wildcard and delete
        // far more (cross-tenant) scan rows than the one domain intended. The
        // exact-match arm uses the raw value ($1); only the LIKE arm uses the
        // escaped value ($2). Backslash is PostgreSQL's default LIKE escape.
        const likeEscaped = normalizedValue.replace(/[\\%_]/g, "\\$&");
        // Delete all scans matching the blocked domain (exact or subdomain)
        const result = await pool.query(
          `
          DELETE FROM scan_history
          WHERE
            -- Match domain exactly after stripping protocol
            LOWER(REGEXP_REPLACE(url, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1')) = LOWER($1)
            -- Match subdomain (hostname ends with .domain)
            OR LOWER(REGEXP_REPLACE(url, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1')) LIKE '%.' || LOWER($2)
          RETURNING id
        `,
          [normalizedValue, likeEscaped],
        );

        const deletedCount = result.rowCount || 0;

        // Log audit action
        await logAction(
          user.id,
          null,
          "blocked_data_delete",
          `Deleted ${deletedCount} scans for blocked value: ${value}`,
          ip,
        );

        return NextResponse.json({
          success: true,
          deletedCount,
          message: `Deleted ${deletedCount} scan(s) matching "${value}"`,
        });
      }

      case "purge_host_reputation": {
        // Compliance safety net for the rare legal/takedown-request case:
        // wipe the cached host_reputation row for a single host. Normal
        // retention/GDPR deletes never touch this table (see the comments
        // in lib/database/cleanup.ts and app/api/v3/data-request/route.ts)
        // since it holds no personal identifier, but a host itself can
        // still be the subject of a takedown request.
        if (!value) {
          return NextResponse.json({ error: "Missing value" }, { status: 400 });
        }

        const host = normalizeHostForReputation(value);
        if (!host) {
          return NextResponse.json(
            { error: "Invalid host value." },
            { status: 400 },
          );
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
          `Purged cached host reputation for "${host}" (legal/takedown request).`,
          ip,
        );

        return NextResponse.json({
          success: true,
          deleted,
          host,
          message: deleted
            ? `Purged cached reputation for "${host}".`
            : `No cached reputation existed for "${host}".`,
        });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Admin Blocked Data] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
