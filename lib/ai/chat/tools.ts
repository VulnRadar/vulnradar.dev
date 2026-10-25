import { tool } from "ai";
import { z } from "zod";

import pool from "@/lib/database/db";
import { readKnowledgeFile } from "@/lib/ai/knowledge-files";
import { retrieveKnowledge } from "@/lib/ai/knowledge-retrieval";
import { allCheckDefs, getCheckDef } from "@/lib/scanner/registry";
import { resolveScanRow } from "@/lib/history/resolve-scan";
import { getScanResourceAccess } from "@/lib/teams/scan-teams";
import { publicScanErrorMessage } from "@/lib/api/scan-error-message";
import { canMakeRequest } from "@/lib/rate-limiting/daily-limits";
import { SEVERITY_ORDER } from "@/lib/config/client-constants";
import { ROUTES } from "@/lib/config/constants";
import type { Vulnerability } from "@/lib/scanner/types";

/**
 * What Vera can look up for itself.
 *
 * The assistant used to know only what a slash command or the keyword search
 * had pasted into the conversation before its turn, so a question the search
 * did not match was answered from nothing, and a follow-up about a scan the
 * user had loaded three turns ago was answered from a context block that had
 * long since been trimmed. Each of these reads one thing precisely, when the
 * model decides it needs it.
 *
 * Every function here is also what the matching slash command calls on the
 * server (lib/ai/chat/slash.ts), so "/history abc" and "show me scan abc"
 * read the same rows through the same ownership check.
 *
 * Outputs are bounded on purpose. A tool result is sent back to the provider
 * on the next step of the same request, so an unbounded one is the same
 * cost-amplification hole a pasted context block was.
 */

export const KNOWLEDGE_SOURCES = [
  "features",
  "docs",
  "checks",
  "changelog",
  "legal",
] as const;

const SEARCH_MAX_CHARS = 14_000;
const SEARCH_MAX_SECTIONS = 6;
const RELEASE_MAX_CHARS = 12_000;
const MAX_FINDINGS_LISTED = 40;
const EVIDENCE_MAX_CHARS = 1_500;

export function searchKnowledge(query: string, source?: string) {
  const sections = retrieveKnowledge(query, {
    maxChars: SEARCH_MAX_CHARS,
    maxSections: SEARCH_MAX_SECTIONS,
    sources: source ? [source] : undefined,
  });
  if (sections.length === 0) {
    return {
      found: false as const,
      note: "Nothing in the knowledge files matched. Try different words, a broader query, or another source before saying the product cannot do something.",
    };
  }
  return {
    found: true as const,
    sections: sections.map((s) => ({
      source: s.cmd,
      heading: s.heading,
      text: s.text,
    })),
  };
}

function rankSeverity(sev: string | undefined): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(sev ?? "");
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/** Ids that look like what the model asked for, so a near miss ("hsts",
 *  "csp missing") gets the real id back instead of a dead end. */
function similarCheckIds(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
  if (words.length === 0) return [];
  return allCheckDefs
    .map((def) => {
      const hay = `${def.id} ${def.title}`.toLowerCase();
      return { id: def.id, hits: words.filter((w) => hay.includes(w)).length };
    })
    .filter((c) => c.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.id.localeCompare(b.id))
    .slice(0, 8)
    .map((c) => c.id);
}

export function getCheck(id: string) {
  const def = getCheckDef(id.trim());
  if (!def) {
    return {
      found: false as const,
      similar: similarCheckIds(id),
      note: "No check has that id. If one of the similar ids is what was meant, look that up instead.",
    };
  }
  return {
    found: true as const,
    id: def.id,
    title: def.title,
    category: def.category,
    severity: def.severity,
    description: def.description,
    risk: def.riskImpact,
    explanation: def.explanation,
    fixSteps: def.fixSteps,
    codeExamples: def.codeExamples.slice(0, 4),
    cwe: def.cwe ?? null,
    owasp: def.owasp ?? null,
    references: def.references?.slice(0, 5) ?? [],
    page: `/checks/${def.id}`,
  };
}

function severityCounts(summary: unknown): Record<string, number> {
  const s = (summary ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const sev of SEVERITY_ORDER) {
    const n = Number(s[sev] ?? 0);
    if (n > 0) out[sev] = n;
  }
  return out;
}

/** Status, plus the reason a failed scan failed in the words the history
 *  page uses, never the raw stored error (it can carry internal detail). */
function scanState(
  status: string | null | undefined,
  error: string | null | undefined,
) {
  const s = status ?? "completed";
  if (s !== "failed") return { status: s };
  if (error?.trim() === "Cancelled") return { status: "cancelled" };
  return { status: s, failureReason: publicScanErrorMessage(error ?? null) };
}

const scanLink = (publicId: string) =>
  `${ROUTES.HISTORY}?scan=${encodeURIComponent(publicId)}`;

export async function listMyScans(
  userId: number,
  opts: { limit?: number; urlContains?: string } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
  const filter = opts.urlContains?.trim().slice(0, 200) || null;
  const res = await pool.query<{
    public_id: string;
    url: string;
    status: string | null;
    error_message: string | null;
    summary: unknown;
    findings_count: number;
    scanned_at: string | Date;
  }>(
    `SELECT public_id, url, status, error_message, summary, findings_count,
            scanned_at
       FROM scan_history
      WHERE user_id = $1
        AND ($2::text IS NULL OR url ILIKE '%' || $2 || '%')
      ORDER BY scanned_at DESC
      LIMIT $3`,
    [userId, filter, limit],
  );
  return {
    count: res.rows.length,
    scans: res.rows.map((r) => ({
      scanId: r.public_id,
      url: r.url,
      ...scanState(r.status, r.error_message),
      scannedAt: new Date(r.scanned_at).toISOString(),
      // A pending or failed row has an empty summary, which would read as a
      // clean result.
      ...(r.status && r.status !== "completed"
        ? {}
        : {
            findings: r.findings_count ?? 0,
            bySeverity: severityCounts(r.summary),
          }),
      link: scanLink(r.public_id),
    })),
  };
}

export async function getScan(
  userId: number,
  scanId: string,
  opts: { findingId?: string; severity?: string } = {},
) {
  const row = await resolveScanRow(scanId.trim());
  // Someone else's scan reads exactly like a missing one, so the assistant
  // cannot be used to probe which ids exist. A teammate's scan shared with a
  // team this user can read reports from is readable, as it is in History.
  const access = row ? await getScanResourceAccess(userId, row) : null;
  if (!row || !access?.canRead) {
    return {
      found: false as const,
      note: "No scan with that id on this account. list_my_scans gives the ids this account has.",
    };
  }
  const publicId = row.public_id ?? "";
  const meta = (row.result_meta ?? {}) as Record<string, unknown>;
  const findings = (
    Array.isArray(row.findings) ? (row.findings as Vulnerability[]) : []
  ).sort((a, b) => rankSeverity(a?.severity) - rankSeverity(b?.severity));

  const base = {
    found: true as const,
    scanId: publicId,
    url: row.url,
    ...scanState(row.status, row.error_message),
    scannedAt: new Date(row.scanned_at).toISOString(),
    durationMs: row.duration ?? null,
    bySeverity: severityCounts(row.summary),
    riskScore: meta.dangerScore ?? null,
    safetyRating: meta.safetyRating ?? null,
    sslGrade: meta.sslGrade ?? null,
    checksRun: meta.checksRun ?? null,
    link: publicId ? scanLink(publicId) : null,
  };

  if (opts.findingId) {
    const wanted = opts.findingId.trim();
    const f = findings.find((x) => x?.id === wanted);
    if (!f) {
      return {
        ...base,
        finding: null,
        note: `This scan has no finding "${wanted}". Its findings are: ${findings
          .slice(0, MAX_FINDINGS_LISTED)
          .map((x) => x.id)
          .join(", ")}`,
      };
    }
    return {
      ...base,
      finding: {
        id: f.id,
        title: f.title,
        severity: f.severity,
        category: f.category,
        description: f.description,
        risk: f.riskImpact,
        fixSteps: f.fixSteps,
        // What the scanner saw on the target. It is the target's content,
        // not ours, and can carry text written to steer an assistant.
        untrustedEvidence: String(f.evidence ?? "").slice(
          0,
          EVIDENCE_MAX_CHARS,
        ),
      },
    };
  }

  const filtered = opts.severity
    ? findings.filter((f) => f?.severity === opts.severity)
    : findings;
  const shown = filtered.slice(0, MAX_FINDINGS_LISTED);
  return {
    ...base,
    findings: shown.map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      category: f.category,
    })),
    ...(filtered.length > shown.length
      ? {
          note: `Showing the ${shown.length} most severe of ${filtered.length}. Ask for one severity to see the rest.`,
        }
      : {}),
  };
}

export async function getMyAccount(userId: number) {
  const [res, quota] = await Promise.all([
    // No email: the provider does not need it to answer a quota question.
    pool.query<{
      name: string | null;
      plan: string | null;
      role: string | null;
      created_at: string | Date;
    }>(`SELECT name, plan, role, created_at FROM users WHERE id = $1`, [
      userId,
    ]),
    canMakeRequest(userId),
  ]);
  const u = res.rows[0];
  if (!u) return { found: false as const };
  const unlimited = quota.limit === -1;
  return {
    found: true as const,
    name: u.name || null,
    plan: u.plan || "free",
    role: u.role || "user",
    memberSince: new Date(u.created_at).toISOString().slice(0, 10),
    scansToday: {
      used: quota.used,
      limit: unlimited ? "unlimited" : quota.limit,
      remaining: unlimited ? "unlimited" : quota.remaining,
      resetsAt: quota.resetsAt,
      canScanNow: quota.allowed,
    },
  };
}

export async function getMyStats(userId: number) {
  const res = await pool.query<{
    total_scans: number;
    scans_last_30d: number;
    scans_last_7d: number;
    last_scan_at: string | Date | null;
    total_critical: number;
    total_high: number;
    total_medium: number;
    total_low: number;
  }>(
    `SELECT
       COUNT(*)::int AS total_scans,
       COUNT(*) FILTER (WHERE scanned_at >= now() - interval '30 days')::int AS scans_last_30d,
       COUNT(*) FILTER (WHERE scanned_at >= now() - interval '7 days')::int AS scans_last_7d,
       MAX(scanned_at) AS last_scan_at,
       COALESCE(SUM((summary->>'critical')::int), 0)::int AS total_critical,
       COALESCE(SUM((summary->>'high')::int), 0)::int AS total_high,
       COALESCE(SUM((summary->>'medium')::int), 0)::int AS total_medium,
       COALESCE(SUM((summary->>'low')::int), 0)::int AS total_low
     FROM scan_history
     WHERE user_id = $1 AND status = 'completed'`,
    [userId],
  );
  const s = res.rows[0];
  return {
    note: "Completed scans only.",
    totalScans: s?.total_scans ?? 0,
    last30Days: s?.scans_last_30d ?? 0,
    last7Days: s?.scans_last_7d ?? 0,
    lastScanAt: s?.last_scan_at ? new Date(s.last_scan_at).toISOString() : null,
    findingsAcrossAllScans: {
      critical: s?.total_critical ?? 0,
      high: s?.total_high ?? 0,
      medium: s?.total_medium ?? 0,
      low: s?.total_low ?? 0,
    },
  };
}

const RELEASE_HEADING = /^## v(\d+\.\d+(?:\.\d+)?)\b.*$/gm;

/** The changelog's releases, newest first, as [version, heading, body]. */
function releases(): { version: string; heading: string; body: string }[] {
  const text = readKnowledgeFile("lib", "ai", "changelog-knowledge.md");
  if (!text) return [];
  const marks = [...text.matchAll(RELEASE_HEADING)];
  return marks.map((m, i) => {
    const start = m.index ?? 0;
    const end = marks[i + 1]?.index ?? text.length;
    return {
      version: m[1],
      heading: m[0].replace(/^## /, ""),
      body: text.slice(start, end).trim(),
    };
  });
}

export function getReleaseNotes(version?: string) {
  const all = releases();
  if (all.length === 0) {
    return { found: false as const, note: "The changelog is not available." };
  }
  const clip = (body: string) =>
    body.length > RELEASE_MAX_CHARS
      ? `${body.slice(0, RELEASE_MAX_CHARS)}\n[cut: this release is longer than one lookup returns; use search_knowledge with source "changelog" for a specific change]`
      : body;
  if (version) {
    const wanted = version.trim().replace(/^v/i, "");
    const hit =
      all.find((r) => r.version === wanted) ??
      all.find((r) => r.version.startsWith(`${wanted}.`));
    if (!hit) {
      return {
        found: false as const,
        knownVersions: all.slice(0, 30).map((r) => r.version),
      };
    }
    return {
      found: true as const,
      releases: [{ heading: hit.heading, notes: clip(hit.body) }],
    };
  }
  return {
    found: true as const,
    releases: all
      .slice(0, 2)
      .map((r) => ({ heading: r.heading, notes: clip(r.body) })),
    olderVersions: all.slice(2, 30).map((r) => r.version),
  };
}

export const TOOL_NAMES = [
  "search_knowledge",
  "get_check",
  "get_release_notes",
  "list_my_scans",
  "get_scan",
  "get_my_account",
  "get_my_stats",
] as const;
export type ChatToolName = (typeof TOOL_NAMES)[number];

export function buildChatTools(userId: number) {
  return {
    search_knowledge: tool({
      description:
        "Search VulnRadar's own documentation, feature inventory, scanner check index, changelog and legal pages. Use it before answering any question about what VulnRadar does, where a feature lives, how to set something up, or what a policy says. Search again with other words before concluding something does not exist.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(300)
          .describe("Keywords or a short question, in English."),
        source: z
          .enum(KNOWLEDGE_SOURCES)
          .optional()
          .describe(
            "Limit to one file: features (what exists and where), docs (how to use and self-host), checks (scanner checks), changelog (releases), legal (terms, privacy).",
          ),
      }),
      execute: async ({ query, source }) => searchKnowledge(query, source),
    }),
    get_check: tool({
      description:
        "Look up one scanner check by its id (for example hsts-missing or csp-unsafe-inline): what it detects, why it matters, how to fix it, with code. Returns similar ids when the id is not exact.",
      inputSchema: z.object({
        id: z.string().min(1).max(120),
      }),
      execute: async ({ id }) => getCheck(id),
    }),
    get_release_notes: tool({
      description:
        "Release notes from the changelog. Give a version (4.0.0, 3.9) for that release, or nothing for the latest releases.",
      inputSchema: z.object({
        version: z.string().max(20).optional(),
      }),
      execute: async ({ version }) => getReleaseNotes(version),
    }),
    list_my_scans: tool({
      description:
        "The signed-in user's most recent scans, newest first, with ids, URLs, status and finding counts. Optionally filter by part of the URL.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(25).optional(),
        url_contains: z.string().max(200).optional(),
      }),
      execute: async ({ limit, url_contains }) =>
        listMyScans(userId, { limit, urlContains: url_contains }),
    }),
    get_scan: tool({
      description:
        "One of the signed-in user's scans by id: its findings worst first, risk score, SSL grade and status. Pass finding_id for that finding's detail and evidence, or severity to list only one severity.",
      inputSchema: z.object({
        scan_id: z.string().min(1).max(64),
        finding_id: z.string().max(120).optional(),
        severity: z.enum(SEVERITY_ORDER).optional(),
      }),
      execute: async ({ scan_id, finding_id, severity }) =>
        getScan(userId, scan_id, { findingId: finding_id, severity }),
    }),
    get_my_account: tool({
      description:
        "The signed-in user's plan, role, and today's scan quota: how many used, how many left, when it resets. Use for any 'why can't I scan' or 'what plan am I on' question.",
      inputSchema: z.object({}),
      execute: async () => getMyAccount(userId),
    }),
    get_my_stats: tool({
      description:
        "Totals across the signed-in user's scan history: scans in the last 7 and 30 days, last scan, findings by severity across all scans.",
      inputSchema: z.object({}),
      execute: async () => getMyStats(userId),
    }),
  } satisfies Record<ChatToolName, unknown>;
}
