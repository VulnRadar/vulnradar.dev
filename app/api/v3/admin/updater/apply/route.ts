import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import {
  requireAdmin,
  isSuperAdminRole,
  logAction,
} from "@/lib/auth/authorization";
import { verifyPassword } from "@/lib/auth/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp } from "@/lib/api/request-utils";
import { parseBody } from "@/lib/api/api-utils";
import { isUpdaterSupported } from "@/lib/updater/environment";
import { createJob, getActiveJobId, getJob } from "@/lib/updater/job-store";
import { runUpdateJob } from "@/lib/updater/apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApplyBody {
  currentAdminPassword?: string;
  targetVersion?: string;
}

/**
 * POST /api/v3/admin/updater/apply
 *
 * Downloads, verifies, and installs a VulnRadar release over the running
 * app directory, then runs npm ci / npm run db:migrate (backing up the
 * database first). Deliberately does NOT run npm run build or restart
 * the process -- the admin builds and restarts manually afterward.
 *
 * This is, by design, "let a super_admin trigger code execution on the
 * host": gated hard behind the super_admin role (not just admin/staff),
 * behind the same password re-auth + rate limit pattern
 * app/api/v3/admin/route.ts uses for its own destructive actions
 * (GATED_ACTIONS), and audit-logged. The checksum/signature verification
 * inside runUpdateJob (lib/updater/apply.ts) is the actual control here,
 * not this gate -- this gate only decides *who* may ask for a verified
 * release to be installed.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }
  if (!isSuperAdminRole(admin.role)) {
    return NextResponse.json(
      { error: "Only the super admin can apply updates." },
      { status: 403 },
    );
  }

  const support = isUpdaterSupported();
  if (!support.supported) {
    return NextResponse.json(
      {
        error: support.reason || "Updater is not supported on this deployment.",
      },
      { status: 400 },
    );
  }

  if (getActiveJobId()) {
    return NextResponse.json(
      { error: "An update is already in progress." },
      { status: 409 },
    );
  }

  const ip = await getClientIp();

  // rate-limit: cap re-auth attempts per admin, same limit/key shape the
  // admin PATCH route uses for its own GATED_ACTIONS re-auth.
  const rl = await checkRateLimit({
    key: `updater-reauth:${admin.userId}:${ip}`,
    ...RATE_LIMITS.adminReauth,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  const parsed = await parseBody<ApplyBody>(request);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { currentAdminPassword, targetVersion } = parsed.data;

  if (
    typeof currentAdminPassword !== "string" ||
    currentAdminPassword.length === 0
  ) {
    return NextResponse.json(
      { error: "Re-enter your password to confirm this action." },
      { status: 403 },
    );
  }

  const pwRow = await pool.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [admin.userId],
  );
  if (
    !pwRow.rows[0] ||
    !(await verifyPassword(currentAdminPassword, pwRow.rows[0].password_hash))
  ) {
    return NextResponse.json(
      { error: "Password is incorrect." },
      { status: 403 },
    );
  }

  const version =
    typeof targetVersion === "string" && targetVersion.trim()
      ? targetVersion.trim()
      : "latest";

  const job = createJob(version, admin.userId);
  if (!job) {
    // Lost the race: another request's createJob() reserved the slot
    // between our getActiveJobId() fast-path check above and here. See
    // createJob's own comment for why this second check is the real,
    // atomic gate.
    return NextResponse.json(
      { error: "An update is already in progress." },
      { status: 409 },
    );
  }

  // logAction does one plain, unguarded INSERT (see lib/auth/
  // authorization.ts's logAuditAction) -- a transient DB blip here would
  // otherwise throw between createJob() (already reserved the active-job
  // slot above) and runUpdateJob() ever starting, which never calls
  // finishJob() to release that slot. The job would sit at "pending"
  // forever, and every future POST here would 409 "already in progress"
  // until the process restarts. Audit logging losing one entry is a far
  // smaller problem than the updater becoming permanently unusable, so
  // this is best-effort: log and continue, same as every other
  // non-critical write in the update flow (lib/updater/apply.ts's own
  // webhook/notification calls).
  try {
    await logAction(
      admin.userId,
      null,
      "updater_apply_started",
      `Started self-update to ${version} (job ${job.id})`,
      ip,
    );
  } catch (err) {
    console.error(
      "[updater] Failed to write audit log for updater_apply_started (non-fatal):",
      err,
    );
  }

  // Fire-and-forget: runUpdateJob catches its own errors and records them
  // on the job (see lib/updater/apply.ts), so the .catch here only
  // guards against something throwing before the job store is touched.
  void runUpdateJob(job.id, version).catch((err) => {
    console.error(
      "[updater] runUpdateJob crashed outside its own try/catch",
      err,
    );
  });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}

/**
 * GET /api/v3/admin/updater/apply?jobId=...
 *
 * Poll endpoint for the job started by POST above. Any admin (not just
 * super_admin) may view progress -- the mutation itself stays gated, but
 * watching an in-flight update shouldn't require re-entering a password.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ activeJobId: getActiveJobId() });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({ job });
}
