import { NextRequest, NextResponse } from "next/server";
import { readKnowledgeFile } from "@/lib/ai/knowledge-files";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { canMakeRequest } from "@/lib/rate-limiting/daily-limits";
import { SEVERITY_ORDER } from "@/lib/config/client-constants";
import type { Vulnerability } from "@/lib/scanner/types";
import { buildHelpText } from "@/lib/ai/commands";
import { APP_NAME, TOTAL_CHECKS_LABEL } from "@/lib/config/constants";

export const runtime = "nodejs";

type ContextResult = {
  cmd: string;
  label: string;
  summary: string;
  content: string;
};

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
    return await handleContext(cmd, id, request, session);
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
  // Resolved once by GET above and threaded through. Each branch used to call
  // getSession() again, so the history / me / stats commands paid two session
  // queries per request for the same row.
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<Response> {
  let result: ContextResult;

  switch (cmd) {
    case "features": {
      const content = readKnowledgeFile("lib", "ai", "features-knowledge.md");
      result = {
        cmd,
        label: "Product Features",
        summary: content
          ? `Feature inventory loaded. Ask me what ${APP_NAME} can do or where a feature lives.`
          : "Feature inventory not available. Run `npm run build:knowledge` to generate it.",
        content,
      };
      break;
    }

    case "docs": {
      const content = readKnowledgeFile("lib", "ai", "docs-knowledge.md");
      result = {
        cmd,
        label: "Documentation",
        summary: content
          ? `Documentation loaded. Ask me anything about ${APP_NAME}.`
          : "Documentation not available. Run `npm run build:knowledge` to generate it.",
        content,
      };
      break;
    }

    case "changelog": {
      // Index first, same as "checks" below. The full file is 3.5x this and
      // was ~107k tokens by the 3.9.0 release: enough on its own to crowd out
      // any other loaded command and push it past the chat route's context
      // budget, which is how /changelog came to be "forgotten" right after
      // being loaded. The index carries every release that has ever shipped,
      // with full descriptions for the recent ones, and the full file stays
      // the retrieval corpus so an older release still arrives in full when a
      // question matches it (lib/ai/knowledge-retrieval.ts).
      let content = readKnowledgeFile("lib", "ai", "changelog-index.md");
      if (!content)
        content = readKnowledgeFile("lib", "ai", "changelog-knowledge.md");
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
          ? `Scanner checks index loaded (${TOTAL_CHECKS_LABEL} checks). Ask about any finding ID or category.`
          : "Checks index not available. Run `npm run build:knowledge` to generate it.",
        content,
      };
      break;
    }

    case "legal": {
      const content = readKnowledgeFile("lib", "ai", "legal-knowledge.md");
      result = {
        cmd,
        label: "Legal Pages",
        summary: content
          ? "Legal pages loaded (Terms, Privacy, Acceptable Use, Disclaimer, DMCA, Accessibility). Ask me anything about data retention, account access, or usage terms."
          : "Legal pages not available. Run `npm run build:knowledge` to generate it.",
        content,
      };
      break;
    }

    case "history": {
      if (id) {
        // Single scan by ID
        const scanId = parseInt(id, 10);
        if (isNaN(scanId)) {
          return NextResponse.json(
            { error: "Invalid scan ID." },
            { status: 400 },
          );
        }

        // `findings` is selected now, and it is the point of this change.
        // This loaded the severity COUNTS and nothing else, so the assistant
        // could say "that scan has one critical" and could not say which one
        // - the single most likely thing to be asked next, on the surface
        // whose whole job is explaining findings. The column was already
        // there; it simply was not read.
        const res = await pool.query(
          `SELECT id, url, summary, findings, findings_count, duration,
                  scanned_at, source
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

        // Worst first, and capped.
        //
        // Ordered by SEVERITY_ORDER rather than by however the engine happened
        // to emit them, because if the list is cut the reader must lose the
        // info-level noise and never the critical. The cap exists because a
        // scan can carry hundreds of findings and this whole block is spent
        // from the per-command context budget in app/api/v3/ai/chat: without
        // one, a single busy scan could crowd out every other block loaded
        // beside it. A cut list says so in the list, so the model reports a
        // limit rather than answering as though it had seen everything.
        //
        // Title, severity, category and id only. The description, evidence and
        // fix for a check are already retrievable by id through /finding, so
        // repeating them per finding would spend the budget on text the
        // assistant can fetch precisely when it is actually asked about.
        const MAX_FINDINGS_LISTED = 40;
        const rawFindings = Array.isArray(scan.findings)
          ? (scan.findings as Vulnerability[])
          : [];
        const rank = (sev: string) => {
          const i = (SEVERITY_ORDER as readonly string[]).indexOf(sev);
          return i === -1 ? SEVERITY_ORDER.length : i;
        };
        const ordered = [...rawFindings].sort(
          (a, b) => rank(a?.severity) - rank(b?.severity),
        );
        const shown = ordered.slice(0, MAX_FINDINGS_LISTED);
        const findingsSection = shown.length
          ? `## Findings\n\n` +
            shown
              .map(
                (f) =>
                  `- **${f.severity}** \`${f.id}\` ${f.title}` +
                  (f.category ? ` _(${f.category})_` : ""),
              )
              .join("\n") +
            (ordered.length > shown.length
              ? `\n\n_Showing the ${shown.length} most severe of ${ordered.length}. Ask about a severity or category to see the rest._`
              : "") +
            `\n\nUse \`/finding [id]\` for what a check looks for and how to fix it.\n`
          : "";

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
                .join("\n")}\n\n`
            : "") +
          findingsSection;

        result = {
          cmd,
          label: `Scan #${scanId}`,
          summary: shown.length
            ? `Scan #${scanId} loaded (${scan.url}, ${date}): ${severities}.`
            : `Scan #${scanId} loaded (${scan.url}, ${date}).`,
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
      const res = await pool.query(
        `SELECT name, email, plan, role, created_at
           FROM users WHERE id = $1`,
        [session.userId],
      );

      if (res.rows.length === 0) {
        return NextResponse.json({ error: "User not found." }, { status: 404 });
      }

      const u = res.rows[0];
      // The live cap AND today's usage against it.
      //
      // This loaded only the cap. "Your daily scan limit is 25" does not
      // answer the question people actually bring to the assistant, which is
      // some form of "why can't I scan right now" - and the number that
      // answers it, how many are left today, was the one thing the assistant
      // could not see. It would then reason from the cap alone and guess.
      //
      // canMakeRequest resolves the cap, today's count, the remainder and the
      // reset instant in one call, and is what the scan routes themselves
      // gate on. Reusing it means the assistant quotes the number that will
      // actually allow or refuse the next scan, rather than a second opinion
      // computed from a different query.
      const quota = await canMakeRequest(session.userId);
      // canMakeRequest reports an unlimited plan as -1, not Infinity.
      const unlimited = quota.limit === -1;
      const dailyLimitLabel = unlimited ? "Unlimited" : String(quota.limit);

      const joined = new Date(u.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const usageLines = unlimited
        ? `**Scans used today:** ${quota.used} (this plan has no daily cap)\n`
        : `**Scans used today:** ${quota.used} of ${quota.limit}\n` +
          `**Remaining today:** ${quota.remaining}\n` +
          `**Quota resets:** ${new Date(quota.resetsAt).toUTCString()}\n`;

      const content =
        `# Your Account\n\n` +
        `**Name:** ${u.name || "Not set"}\n` +
        `**Email:** ${u.email}\n` +
        `**Plan:** ${u.plan || "free"}\n` +
        `**Role:** ${u.role || "user"}\n` +
        `**Daily scan limit:** ${dailyLimitLabel}\n` +
        usageLines +
        `**Member since:** ${joined}\n`;

      result = {
        cmd,
        label: "My Account",
        // The remainder goes in the summary too, not just the body. The
        // summary is what the widget shows the person directly; the body is
        // for the model. "Why can't I scan" deserves an answer they can read
        // without asking a follow-up question.
        summary: unlimited
          ? `Account info loaded for ${u.name || u.email}.`
          : `Account info loaded for ${u.name || u.email}: ${quota.remaining} of ${quota.limit} scans left today.`,
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

  // Last line of defence on size, applied to every command rather than to the
  // two that have needed it. The chat route skips a context block over its
  // budget, silently, and the symptom is the assistant not knowing what it was
  // just handed: /changelog reached 506 KB that way and nobody could see why.
  // tests/lib/ai/context-budget.test.ts keeps normal operation far under this,
  // so reaching it means either a knowledge file grew past what that test
  // allows or an index is missing and a command fell back to its full corpus
  // (checks-knowledge.md alone is 1.2 MB). Cutting it here at least says so in
  // the content the model reads, which beats the block vanishing on the way.
  const MAX_CONTEXT_RESPONSE_CHARS = 250_000;
  if (result.content.length > MAX_CONTEXT_RESPONSE_CHARS) {
    console.error(
      `[ai/context] ${result.cmd} returned ${result.content.length} chars, truncating to ${MAX_CONTEXT_RESPONSE_CHARS}`,
    );
    result = {
      ...result,
      content:
        result.content.slice(0, MAX_CONTEXT_RESPONSE_CHARS) +
        "\n\n[This context was truncated because it exceeded the size one " +
        "message can carry. Say so if the answer needs something past this " +
        "point rather than answering as though nothing is missing.]",
    };
  }

  return NextResponse.json(result);
}
