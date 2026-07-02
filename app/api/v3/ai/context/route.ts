import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { buildHelpText } from "@/lib/ai/commands";

export const runtime = "nodejs";

type ContextResult = {
  cmd: string;
  label: string;
  summary: string;
  content: string;
};

function readKnowledgeFile(...segments: string[]): string {
  const p = join(process.cwd(), ...segments);
  if (!existsSync(p)) return "";
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Sign in to load AI context." },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const cmd = searchParams.get("cmd")?.toLowerCase() || "";
  const id = searchParams.get("id") || "";

  try {
    return await handleContext(cmd, id, request);
  } catch (err) {
    console.error("[ai/context] unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred loading that context." },
      { status: 500 },
    );
  }
}

async function handleContext(
  cmd: string,
  id: string,
  _request: NextRequest,
): Promise<Response> {
  let result: ContextResult;

  switch (cmd) {
    case "docs": {
      const content = readKnowledgeFile("lib", "ai", "docs-knowledge.md");
      result = {
        cmd,
        label: "Documentation",
        summary: content
          ? "Documentation loaded. Ask me anything about VulnRadar."
          : "Documentation not available. Run `npm run build:knowledge` to generate it.",
        content,
      };
      break;
    }

    case "changelog": {
      const content = readKnowledgeFile("lib", "ai", "changelog-knowledge.md");
      result = {
        cmd,
        label: "Changelog",
        summary: content
          ? "Changelog loaded. Ask me about any version or release."
          : "Changelog not available. Run `npm run build:knowledge` to generate it.",
        content,
      };
      break;
    }

    case "checks": {
      let content = readKnowledgeFile("lib", "ai", "checks-index.md");
      if (!content)
        content = readKnowledgeFile("lib", "ai", "checks-knowledge.md");
      result = {
        cmd,
        label: "Scanner Checks",
        summary: content
          ? "Scanner checks index loaded (700+ checks). Ask about any finding ID or category."
          : "Checks index not available. Run `npm run build:knowledge` to generate it.",
        content,
      };
      break;
    }

    case "history": {
      const session = await getSession();
      if (!session) {
        return NextResponse.json(
          { error: "Sign in to access your scan history." },
          { status: 401 },
        );
      }

      if (id) {
        // Single scan by ID
        const scanId = parseInt(id, 10);
        if (isNaN(scanId)) {
          return NextResponse.json(
            { error: "Invalid scan ID." },
            { status: 400 },
          );
        }

        const res = await pool.query(
          `SELECT id, url, summary, findings_count, duration, scanned_at, source
             FROM scan_history
             WHERE id = $1 AND user_id = $2`,
          [scanId, session.userId],
        );

        if (res.rows.length === 0) {
          return NextResponse.json(
            {
              error: `Scan #${scanId} not found or does not belong to your account.`,
            },
            { status: 404 },
          );
        }

        const scan = res.rows[0];
        const date = new Date(scan.scanned_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
        const summary = scan.summary as Record<string, number> | null;
        const severities = summary
          ? Object.entries(summary)
              .filter(([, count]) => count > 0)
              .map(([sev, count]) => `${count} ${sev}`)
              .join(", ")
          : "no findings";

        const content =
          `# Scan #${scan.id}\n\n` +
          `**URL:** ${scan.url}\n` +
          `**Date:** ${date}\n` +
          `**Duration:** ${scan.duration ?? "—"}ms\n` +
          `**Findings:** ${severities}\n` +
          `**Source:** ${scan.source || "web"}\n\n` +
          (summary
            ? `## Summary\n\n${Object.entries(summary)
                .map(([sev, count]) => `- **${sev}:** ${count}`)
                .join("\n")}\n`
            : "");

        result = {
          cmd,
          label: `Scan #${scanId}`,
          summary: `Scan #${scanId} loaded (${scan.url}, ${date}).`,
          content,
        };
      } else {
        // Recent scans list
        const res = await pool.query(
          `SELECT id, url, summary, findings_count, scanned_at
             FROM scan_history
             WHERE user_id = $1
             ORDER BY scanned_at DESC
             LIMIT 20`,
          [session.userId],
        );

        if (res.rows.length === 0) {
          result = {
            cmd,
            label: "Scan History",
            summary: "No scans found. Run your first scan at the dashboard.",
            content: "No scan history found.",
          };
        } else {
          const lines = res.rows.map((row) => {
            const date = new Date(row.scanned_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const s = row.summary as Record<string, number> | null;
            const counts = s
              ? Object.entries(s)
                  .filter(([, c]) => c > 0)
                  .map(([sev, c]) => `${c} ${sev}`)
                  .join(", ") || "0 findings"
              : `${row.findings_count ?? 0} findings`;
            return `- Scan #${row.id}: ${row.url} — ${date} — ${counts}`;
          });

          const content = `# Your Recent Scans (last 20)\n\n${lines.join("\n")}\n\nUse \`/history [id]\` to load details for a specific scan.`;
          result = {
            cmd,
            label: "Scan History",
            summary: `Loaded your last ${res.rows.length} scans.`,
            content,
          };
        }
      }
      break;
    }

    case "me": {
      const session = await getSession();
      if (!session) {
        return NextResponse.json(
          { error: "Sign in to load your account info." },
          { status: 401 },
        );
      }

      const res = await pool.query(
        `SELECT name, email, plan, role, created_at, daily_scan_limit
           FROM users WHERE id = $1`,
        [session.userId],
      );

      if (res.rows.length === 0) {
        return NextResponse.json({ error: "User not found." }, { status: 404 });
      }

      const u = res.rows[0];
      const joined = new Date(u.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const content =
        `# Your Account\n\n` +
        `**Name:** ${u.name || "Not set"}\n` +
        `**Email:** ${u.email}\n` +
        `**Plan:** ${u.plan || "free"}\n` +
        `**Role:** ${u.role || "user"}\n` +
        `**Daily scan limit:** ${u.daily_scan_limit ?? "plan default"}\n` +
        `**Member since:** ${joined}\n`;

      result = {
        cmd,
        label: "My Account",
        summary: `Account info loaded for ${u.name || u.email}.`,
        content,
      };
      break;
    }

    case "finding": {
      if (!id) {
        return NextResponse.json(
          {
            error:
              "Provide a finding ID: /finding [id]  (e.g. /finding csp-missing)",
          },
          { status: 400 },
        );
      }

      const knowledgeRaw = readKnowledgeFile(
        "lib",
        "ai",
        "checks-knowledge.md",
      );
      if (!knowledgeRaw) {
        result = {
          cmd,
          label: `Finding: ${id}`,
          summary:
            "Checks knowledge not available. Run `npm run build:knowledge` to generate it.",
          content: "",
        };
        break;
      }

      // Find the section header matching the id (e.g. ## csp-missing or ### csp-missing)
      const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sectionRe = new RegExp(
        `(#{1,3}\\s+${escapedId}[\\s\\S]*?)(?=^#{1,3}\\s+\\S|$)`,
        "im",
      );
      const match = knowledgeRaw.match(sectionRe);

      if (!match) {
        return NextResponse.json(
          {
            error: `Finding "${id}" not found in the checks index. Use /checks to browse all IDs.`,
          },
          { status: 404 },
        );
      }

      result = {
        cmd,
        label: `Finding: ${id}`,
        summary: `Details for **${id}** loaded. Ask me anything about this finding.`,
        content: match[1].trim(),
      };
      break;
    }

    case "stats": {
      const session = await getSession();
      if (!session) {
        return NextResponse.json(
          { error: "Sign in to view your scan statistics." },
          { status: 401 },
        );
      }

      const res = await pool.query(
        `SELECT
           COUNT(*)::int AS total_scans,
           COUNT(*) FILTER (WHERE scanned_at >= now() - interval '30 days')::int AS scans_last_30d,
           COUNT(*) FILTER (WHERE scanned_at >= now() - interval '7 days')::int AS scans_last_7d,
           MAX(scanned_at) AS last_scan_at,
           MIN(scanned_at) AS first_scan_at,
           COALESCE(SUM((summary->>'critical')::int), 0)::int AS total_critical,
           COALESCE(SUM((summary->>'high')::int), 0)::int AS total_high,
           COALESCE(SUM((summary->>'medium')::int), 0)::int AS total_medium,
           COALESCE(SUM((summary->>'low')::int), 0)::int AS total_low
         FROM scan_history
         WHERE user_id = $1`,
        [session.userId],
      );

      const s = res.rows[0];
      const lastScan = s.last_scan_at
        ? new Date(s.last_scan_at).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "never";

      const content =
        `# Your Scan Statistics\n\n` +
        `**Total scans:** ${s.total_scans}\n` +
        `**Last 30 days:** ${s.scans_last_30d}\n` +
        `**Last 7 days:** ${s.scans_last_7d}\n` +
        `**Last scan:** ${lastScan}\n\n` +
        `## Cumulative Findings\n\n` +
        `- Critical: ${s.total_critical}\n` +
        `- High: ${s.total_high}\n` +
        `- Medium: ${s.total_medium}\n` +
        `- Low: ${s.total_low}\n`;

      result = {
        cmd,
        label: "My Stats",
        summary:
          s.total_scans === 0
            ? "No scans found. Run your first scan at the dashboard."
            : `You've run ${s.total_scans} scan${s.total_scans === 1 ? "" : "s"} total, ${s.scans_last_30d} in the last 30 days.`,
        content,
      };
      break;
    }

    case "help": {
      const content = buildHelpText();
      result = {
        cmd,
        label: "Help",
        summary: "Here are the available slash commands.",
        content,
      };
      break;
    }

    default:
      return NextResponse.json(
        {
          error: `Unknown command: /${cmd}. Use /help to see available commands.`,
        },
        { status: 400 },
      );
  }

  return NextResponse.json(result);
}
