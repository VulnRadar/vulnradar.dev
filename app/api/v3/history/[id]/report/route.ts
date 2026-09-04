import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordUsage } from "@/lib/api/api-keys";
import { validateApiKey } from "@/lib/api/api-keys";
import { checkRateLimit as checkApiKeyRateLimit } from "@/lib/api/api-keys";
import { rateLimitedResponse } from "@/lib/api/rate-limit-response";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { getScanResourceAccess } from "@/lib/teams/scan-teams";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getSetting } from "@/lib/config/runtime-config";
import { resolveScanRow } from "@/lib/history/resolve-scan";
import {
  attachRemediation,
  attachFalsePositiveVerdicts,
} from "@/lib/scanner/remediation-store";
import { severityCounts } from "@/lib/reports/severity-counts";
import {
  ERROR_MESSAGES,
  BEARER_PREFIX,
  APP_SLUG,
} from "@/lib/config/constants";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { generateSarifReport } from "@/lib/reports/sarif-report";
import { generateMarkdownReport } from "@/lib/reports/markdown-report";
import { generateComplianceReport } from "@/lib/reports/compliance-report";
import { generatePdfReport } from "@/lib/reports/pdf-report";
import { generateCsvReport, CSV_BOM } from "@/lib/reports/csv-report";

/**
 * GET /api/v3/history/[id]/report?format=sarif|pdf|md|compliance|csv|json
 *
 * Server-side report generation over a completed scan. The generators in
 * lib/reports/ are pure functions the UI already runs client-side; exposing
 * them here lets CI and API consumers pull a SARIF file (GitHub code scanning),
 * a PDF, a Markdown report, a CSV, or the compliance crosswalk
 * (PCI/SOC2/ISO/ASVS) without a browser. Same auth + access model as GET
 * /api/v3/history/[id]: a Bearer API key with scan:read, or a session cookie;
 * owner or team-read.
 *
 * TRIAGE. Two query parameters, both explicit, because the alternative is an
 * export that quietly disagrees with the dashboard or a CI gate that quietly
 * stops failing:
 *
 *   includeSuppressed=true  keep findings the owner marked a false positive.
 *                           Default false. Off is what the dashboard shows and
 *                           what the stored summary counts, and this route used
 *                           to list them while shipping a summary that excluded
 *                           them -- the same scan exported a different verdict
 *                           than it displayed.
 *   applyTriage=true        mark accepted-risk / won't-fix / false-positive
 *                           findings as SARIF `suppressions`, which GitHub
 *                           Code Scanning reads as "dismissed". Default false:
 *                           turning this on by default would silently stop a
 *                           pipeline failing on a critical somebody accepted
 *                           months ago.
 *
 * Whatever those two resolve to, `summary` is recomputed from the findings
 * actually being exported, so the header and the list can never disagree.
 */

const FORMATS = [
  "json",
  "sarif",
  "pdf",
  "md",
  "markdown",
  "compliance",
  "csv",
] as const;
type ReportFormat = (typeof FORMATS)[number];

/** Query flags are opt-in: only an explicit true/1/yes turns one on. */
function flag(request: NextRequest, name: string): boolean {
  const raw = request.nextUrl.searchParams.get(name);
  if (raw === null) return false;
  return ["1", "true", "yes"].includes(raw.toLowerCase());
}

function fileBase(url: string): string {
  let host = "scan";
  try {
    host = new URL(url).hostname || "scan";
  } catch {
    /* keep default */
  }
  return `${APP_SLUG}-${host}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const format = (
    request.nextUrl.searchParams.get("format") || "json"
  ).toLowerCase();
  if (!FORMATS.includes(format as ReportFormat)) {
    return NextResponse.json(
      {
        error: `Unsupported format. Use one of: json, sarif, pdf, md, compliance, csv.`,
      },
      { status: 400 },
    );
  }

  const includeSuppressed = flag(request, "includeSuppressed");
  const applyTriage = flag(request, "applyTriage");

  // FEATURE_PDF_REPORTS used to gate only the menu item in the browser, so
  // an operator who turned PDF export off still served it to anyone who
  // asked for ?format=pdf directly. Checked here rather than in the switch
  // below so a disabled format costs no scan lookup or report build.
  if (format === "pdf" && !(await getSetting("FEATURE_PDF_REPORTS"))) {
    return NextResponse.json(
      { error: "PDF reports are disabled on this deployment." },
      { status: 403 },
    );
  }

  // Auth: Bearer API key (scan:read) first, then session cookie -- mirrors
  // GET /api/v3/history/[id].
  const authHeader = request.headers.get("authorization");
  let authedUserId: number | null = null;
  let apiKeyId: number | null = null;

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const keyData = await validateApiKey(authHeader.slice(7));
    if (!keyData) {
      return NextResponse.json(
        { error: "Invalid or revoked API key." },
        { status: 401 },
      );
    }
    if (keyData.needsTermsAcceptance) {
      return NextResponse.json(
        { error: "Please accept our updated Terms of Service to use the API." },
        { status: 403 },
      );
    }
    if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_READ)) {
      return NextResponse.json(
        { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_READ) },
        { status: 403 },
      );
    }
    const rateLimit = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit);
    }
    apiKeyId = keyData.keyId;
    authedUserId = keyData.userId;
  } else {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.UNAUTHORIZED },
        { status: 401 },
      );
    }
    authedUserId = session.userId;

    // abuse: the API-key branch above is metered, the session branch was not.
    // Every format on this route builds its report SYNCHRONOUSLY over the
    // whole findings array (generatePdfReport in particular does nested
    // word-wrap loops per finding, per code example, per line), so a signed-in
    // user could loop the export of their largest scan and pin the single Node
    // process's event loop, stalling every other request and every in-flight
    // scan's progress writes.
    const rl = await checkRateLimit({
      key: `report-export:${session.userId}`,
      ...RATE_LIMITS.api,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: `Too many report exports. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSeconds) },
        },
      );
    }
  }

  if (!authedUserId) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const { id } = await params;
  const scan = await resolveScanRow(id);
  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  const isOwner = scan.user_id === authedUserId;
  if (!isOwner) {
    const access = await getScanResourceAccess(authedUserId, scan);
    if (!access.canRead) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }
  }

  if (apiKeyId) await recordUsage(apiKeyId);

  // Owner sees their cross-rescan remediation status and their own
  // false-positive verdicts on each finding; a team-read viewer sees the
  // stored findings as-is, since triage is private to the person who did it.
  const owned = isOwner
    ? await attachFalsePositiveVerdicts(
        authedUserId,
        await attachRemediation(
          authedUserId,
          scan.url,
          (scan.findings || []) as Vulnerability[],
        ),
      )
    : ((scan.findings || []) as Vulnerability[]);

  const findings = includeSuppressed
    ? owned
    : owned.filter((finding) => !finding.suppressed);

  // Derived from the findings actually in this export rather than read from
  // scan_history.summary. The stored summary is recomputed to exclude false
  // positives (lib/scanner/recompute-scan-score.ts) only for the scan the
  // verdict was filed against, so passing it through alongside an unfiltered
  // list let a Markdown export print "3 critical" over four critical
  // findings, or the reverse. One list, one tally, computed together.
  const summary = {
    ...severityCounts(findings),
    total: findings.length,
  };

  const meta = scan.result_meta || {};
  const result = {
    id: scan.id,
    url: scan.url,
    scannedAt: scan.scanned_at,
    duration: scan.duration,
    summary,
    findings,
    responseHeaders: scan.response_headers || undefined,
    authenticated: scan.authenticated || false,
    ...meta,
  } as unknown as ScanResult;

  const base = fileBase(scan.url);

  switch (format) {
    case "sarif":
      return new NextResponse(
        JSON.stringify(
          generateSarifReport(result, { applySuppressions: applyTriage }),
          null,
          2,
        ),
        {
          headers: {
            "Content-Type": "application/sarif+json",
            "Content-Disposition": `attachment; filename="${base}.sarif"`,
          },
        },
      );
    case "csv":
      return new NextResponse(CSV_BOM + generateCsvReport(result), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}.csv"`,
        },
      });
    case "md":
    case "markdown":
      return new NextResponse(generateMarkdownReport(result), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}.md"`,
        },
      });
    case "compliance":
      return new NextResponse(generateComplianceReport(result), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}-compliance.md"`,
        },
      });
    case "pdf":
      return new NextResponse(Buffer.from(generatePdfReport(result)), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${base}.pdf"`,
        },
      });
    default:
      return new NextResponse(JSON.stringify(result, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${base}.json"`,
        },
      });
  }
}
