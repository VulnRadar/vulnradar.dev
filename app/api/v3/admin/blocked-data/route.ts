import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getClientIp } from "@/lib/api/request-utils";
import {
  requireAdmin as _requireAdmin,
  logAction,
} from "@/lib/auth/authorization";
import { normalizeHostForReputation } from "@/lib/scanner/host-reputation";
import {
  normalizeBlockedDomain,
  findScansForBlockedDomain,
  deleteScansForBlockedDomain,
} from "@/lib/admin/blocked-domain-scans";

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

        const domain = normalizeBlockedDomain(value);
        const scans = await findScansForBlockedDomain(domain);

        await logAction(
          user.id,
          null,
          "blocked_data_search",
          `Searched for scans matching blocked value: ${value} (found ${scans.length} results)`,
          ip,
        );

        return NextResponse.json({ scans });
      }

      case "delete_scans": {
        if (!value) {
          return NextResponse.json({ error: "Missing value" }, { status: 400 });
        }

        const domain = normalizeBlockedDomain(value);
        const deletedCount = await deleteScansForBlockedDomain(domain);

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
