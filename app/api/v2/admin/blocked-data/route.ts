import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getClientIp } from "@/lib/api/request-utils";
import {
  requireAdmin as _requireAdmin,
  logAction,
} from "@/lib/auth/authorization";

// R3/D1: requireAdmin moved to lib/auth/authorization.ts (single source).
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

        // Delete all scans matching the blocked domain (exact or subdomain)
        const result = await pool.query(
          `
          DELETE FROM scan_history
          WHERE 
            -- Match domain exactly after stripping protocol
            LOWER(REGEXP_REPLACE(url, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1')) = LOWER($1)
            -- Match subdomain (hostname ends with .domain)
            OR LOWER(REGEXP_REPLACE(url, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1')) LIKE '%.' || LOWER($1)
          RETURNING id
        `,
          [normalizedValue],
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
