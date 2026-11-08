import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ERROR_MESSAGES, APP_NAME, APP_URL } from "@/lib/config/constants";
import {
  resolveScanRow,
  type ScanHistoryRow,
} from "@/lib/history/resolve-scan";
import { getDecryptedGithubToken } from "@/lib/github/github-connections";
import { createRepoIssue, isGithubTimeout } from "@/lib/github/github-api";
import { normalizeHostForReputation } from "@/lib/scanner/host-reputation";
import type { Vulnerability } from "@/lib/scanner/types";
// One list, not a fourth private copy. See its definition for the nine-table
// history that made this worth consolidating.
import { SEVERITY_ORDER } from "@/lib/config/client-constants";

/**
 * POST /api/v3/scan/github-issue
 *
 * Files a scan's findings as a GitHub issue in a repo the caller's connected
 * account can write to ("VulnRadar GitHub Scanner"). Owner-initiated only: the
 * caller must own the scan and have a GitHub connection with write scope.
 * Body: { scanId: <public_id>, repo: "owner/name" }.
 */

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const MAX_FINDINGS_LISTED = 50;

function isRepoScan(scan: ScanHistoryRow): boolean {
  return "scan_type" in scan && scan.scan_type === "github";
}

/** What the issue title calls the target. A repo scan's url is "owner/name". */
function targetLabel(scan: ScanHistoryRow): string {
  if (isRepoScan(scan)) return scan.url;
  return normalizeHostForReputation(scan.url) || scan.url;
}

/**
 * The report a reader of the issue can actually open, or null when there is
 * none. /host/<host> only shows public scans, so a link from a private scan
 * lands on a page that does not have it. A repo scan's url is "owner/name",
 * which parses as a host called "owner": its link would be to somebody else's
 * report, so it gets none even if the row was later marked public.
 */
function publicReportUrl(scan: ScanHistoryRow): string | null {
  if (isRepoScan(scan) || scan.is_public !== true) return null;
  const host = normalizeHostForReputation(scan.url);
  return host ? `${APP_URL}/host/${encodeURIComponent(host)}` : null;
}

function buildIssueBody(
  url: string,
  findings: Vulnerability[],
  summary: Record<string, number>,
  reportUrl: string | null,
): string {
  const counts = SEVERITY_ORDER.map((s) => `${summary[s] ?? 0} ${s}`).join(
    ", ",
  );
  const lines: string[] = [
    `Security scan of \`${url}\` by ${APP_NAME}.`,
    "",
    `**${findings.length} finding${findings.length === 1 ? "" : "s"}**: ${counts}`,
    "",
  ];

  const bySeverity = [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  for (const f of bySeverity.slice(0, MAX_FINDINGS_LISTED)) {
    lines.push(`- **[${f.severity.toUpperCase()}]** ${f.title}`);
  }
  if (bySeverity.length > MAX_FINDINGS_LISTED) {
    lines.push(
      `- ...and ${bySeverity.length - MAX_FINDINGS_LISTED} more${reportUrl ? " (see the full report)" : ""}.`,
    );
  }

  lines.push(
    "",
    "---",
    `Filed by the ${APP_NAME} GitHub Scanner.${reportUrl ? ` Full report: ${reportUrl}` : ""}`,
  );
  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  let body: { scanId?: unknown; repo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const scanId = typeof body.scanId === "string" ? body.scanId : "";
  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  if (!scanId) {
    return NextResponse.json(
      { error: "A scan id is required." },
      { status: 400 },
    );
  }
  if (!REPO_RE.test(repo)) {
    return NextResponse.json(
      { error: "A repository in owner/name form is required." },
      { status: 400 },
    );
  }

  const token = await getDecryptedGithubToken(session.userId);
  if (!token) {
    return NextResponse.json(
      { error: "Connect your GitHub account first to file issues." },
      { status: 400 },
    );
  }

  const scan = await resolveScanRow(scanId);
  if (!scan) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }
  // Owner-only: filing an issue uses the caller's own GitHub token, and a scan's
  // findings are the owner's to export. A teammate can view a scan but not push
  // it into someone else's (or their own) repo on the owner's behalf.
  if (scan.user_id !== session.userId) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const findings = (scan.findings || []) as Vulnerability[];
  const [owner, name] = repo.split("/");
  const title = `[${APP_NAME}] Security findings for ${targetLabel(scan)} (${findings.length})`;
  const issueBody = buildIssueBody(
    scan.url,
    findings,
    (scan.summary || {}) as Record<string, number>,
    publicReportUrl(scan),
  );

  try {
    const created = await createRepoIssue(token, owner, name, {
      title,
      body: issueBody,
      labels: ["security", "vulnradar"],
    });
    return NextResponse.json({ url: created.htmlUrl, number: created.number });
  } catch (err) {
    console.error(
      `[${APP_NAME}] GitHub issue creation failed:`,
      err instanceof Error ? err.message : err,
    );
    // The POST reached GitHub before the clock ran out, so unlike every other
    // failure here the issue may exist. "Try again" would file it twice.
    if (isGithubTimeout(err)) {
      return NextResponse.json(
        {
          error:
            "GitHub did not answer in time. The issue may have been created, so check the repository before filing it again.",
        },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        error:
          "Could not create the issue. Check that your GitHub connection has repo access and that Issues are enabled on the repository.",
      },
      { status: 502 },
    );
  }
}
