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
import { attachRemediation } from "@/lib/scanner/remediation-store";
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

/**
 * GET /api/v3/history/[id]/report?format=sarif|pdf|md|compliance|json
 *
 * Server-side report generation over a completed scan. The generators in
 * lib/reports/ are pure functions the UI already runs client-side; exposing
 * them here lets CI and API consumers pull a SARIF file (GitHub code scanning),
 * a PDF, a Markdown report, or the compliance crosswalk (PCI/SOC2/ISO/ASVS)
 * without a browser. Same auth + access model as GET /api/v3/history/[id]:
 * a Bearer API key with scan:read, or a session cookie; owner or team-read.
 */

const FORMATS = [
  "json",
  "sarif",
  "pdf",
  "md",
  "markdown",
  "compliance",
] as const;
type ReportFormat = (typeof FORMATS)[number];

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
        error: `Unsupported format. Use one of: json, sarif, pdf, md, compliance.`,
      },
      { status: 400 },
    );
  }

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

  // Owner sees their cross-rescan remediation status on each finding; a
  // team-read viewer sees the stored findings as-is (remediation is private).
  const findings = isOwner
    ? await attachRemediation(
        authedUserId,
        scan.url,
        (scan.findings || []) as Vulnerability[],
      )
    : ((scan.findings || []) as Vulnerability[]);

  const meta = scan.result_meta || {};
  const result = {
    id: scan.id,
    url: scan.url,
    scannedAt: scan.scanned_at,
    duration: scan.duration,
    summary: scan.summary,
    findings,
    responseHeaders: scan.response_headers || undefined,
    authenticated: scan.authenticated || false,
    ...meta,
  } as unknown as ScanResult;

  const base = fileBase(scan.url);

  switch (format) {
    case "sarif":
      return new NextResponse(
        JSON.stringify(generateSarifReport(result), null, 2),
        {
          headers: {
            "Content-Type": "application/sarif+json",
            "Content-Disposition": `attachment; filename="${base}.sarif"`,
          },
        },
      );
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
