import { NextResponse } from "next/server";
import { join, resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { requireAdmin, logAction } from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";
import {
  createJob,
  getActiveJobId,
  getLatestJob,
} from "@/lib/backup/job-store";
import { runBackupJob } from "@/lib/backup/run-backup";
import { getSetting } from "@/lib/config/runtime-config";
import { CONFIG_SCHEDULED_BACKUP_INTERVAL_MS } from "@/lib/config/config-values";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BackupFileInfo {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  /** True when a `.json` key sidecar sits beside this dump: it is encrypted
   *  and cannot be restored without that file. */
  encrypted?: boolean;
}

/** Same default scripts/backup-db.mjs itself resolves: BACKUP_DIR, or
 *  ./backups under the app root. Kept in sync deliberately -- this is
 *  what makes GET's file listing describe the same directory POST's
 *  spawned script actually writes into. */
function resolveBackupDir(): string {
  return resolve(process.env.BACKUP_DIR || join(process.cwd(), "backups"));
}

/** Lists the BACKUPS scripts/backup-db.mjs has written into `dir`, newest
 *  first. Missing directory (no backup has ever run) is not an error --
 *  it just means an empty list. Filtered to the "vulnradar-backup-"
 *  prefix so unrelated files (or a stray .gitkeep) don't show up.
 *
 *  One backup is TWO files when encryption is on: the dump itself, and a
 *  ~160 byte `.json` sidecar carrying the AES-256-GCM iv and authTag that
 *  the dump cannot be decrypted without. This listing used to return both,
 *  so one backup rendered as two rows and the panel's count read double:
 *  two backups showed as "4 files", which looks exactly like the job having
 *  run twice. The sidecar is folded into its own backup as the `encrypted`
 *  flag instead, since it is part of that backup rather than a backup. */
async function listBackupFiles(dir: string): Promise<BackupFileInfo[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const ours = names.filter((name) => name.startsWith("vulnradar-backup-"));

  // Sidecars are matched by exact name rather than by stripping a suffix: a
  // dump is "<name>" and its sidecar is exactly "<name>.json", so any other
  // .json here belongs to something else and is left out of the listing
  // instead of being silently attached to an unrelated backup.
  const sidecars = new Set(ours.filter((name) => name.endsWith(".json")));

  const entries = await Promise.all(
    ours
      .filter((name) => !sidecars.has(name))
      .map(async (name): Promise<BackupFileInfo | null> => {
        const s = await stat(join(dir, name)).catch(() => null);
        if (!s) return null;
        return {
          name,
          sizeBytes: s.size,
          modifiedAt: s.mtime.toISOString(),
          encrypted: sidecars.has(`${name}.json`),
        };
      }),
  );
  return entries
    .filter((e): e is BackupFileInfo => e !== null)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/**
 * POST /api/v3/admin/backup
 *
 * AUDIT-010: admin-triggered run of scripts/backup-db.mjs (pg_dump ->
 * gzip -> optional encryption/offsite upload -- see that script's own
 * header for the full mechanism). Single-flight via job-store's
 * createJob check-and-set, same pattern
 * app/api/v3/admin/updater/apply/route.ts uses: this route only starts
 * the job and reserves the slot, lib/backup/run-backup.ts owns the
 * actual spawn/observe.
 */
export async function POST() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  if (getActiveJobId()) {
    return NextResponse.json(
      { error: "A backup is already running." },
      { status: 409 },
    );
  }

  const job = createJob(admin.userId);
  if (!job) {
    // Lost the race against another concurrent POST -- see job-store's
    // createJob comment for why this second check is the real,
    // race-proof gate (the getActiveJobId() check above is only a
    // fast-path).
    return NextResponse.json(
      { error: "A backup is already running." },
      { status: 409 },
    );
  }

  // Best-effort, same rationale as the updater's own
  // updater_apply_started logging: a transient audit-log failure here
  // must not leave the job stuck "active" forever with nothing able to
  // start a new one.
  try {
    const ip = await getClientIp();
    await logAction(
      admin.userId,
      null,
      "backup_started",
      `Started database backup (job ${job.id})`,
      ip,
    );
  } catch (err) {
    console.error(
      "[backup] Failed to write audit log for backup_started (non-fatal):",
      err,
    );
  }

  // Fire-and-forget: runBackupJob resolves the job's own status
  // (success/failed) internally, so the .catch here only guards against
  // something throwing before the job store is ever touched.
  void runBackupJob(job.id).catch((err) => {
    console.error(
      "[backup] runBackupJob crashed outside its own try/catch",
      err,
    );
  });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}

/**
 * GET /api/v3/admin/backup
 *
 * Backup health signal for the admin panel: the most recent backup job
 * this server process has run (in-memory only -- see
 * lib/backup/job-store.ts for why that's fine) plus the part that
 * survives a restart: the actual files sitting in BACKUP_DIR right now,
 * with size and last-modified so staff can tell at a glance whether
 * backups are actually happening.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const backups = await listBackupFiles(resolveBackupDir());

  // Deliberately no `backupDir` (or any other filesystem path) in this
  // response -- the server's absolute directory layout is not something
  // the browser needs, and it's exactly the kind of detail that should
  // never cross the API boundary even to an authenticated admin. Same
  // reasoning applies to job.log below: see the redaction in
  // scripts/backup-db.mjs's "Target:" line, which is the only place a
  // path could otherwise have leaked into it.
  // The schedule, so the panel can say whether an old backup is a fault or
  // just a fact. Without it the tab could only print a date and leave the
  // staleness arithmetic to the reader, or assume schedules are on and cry
  // wolf on a deployment that runs backups by hand. Same two values, read the
  // same way, as GET /api/v3/admin/health's backup row: intervalMs is a
  // source-only setting (registry.ts's non-editable list, the timer reads it
  // once at registration), so the compiled constant is the live value.
  return NextResponse.json({
    job: getLatestJob() ?? null,
    backups,
    lastBackupAt: backups[0]?.modifiedAt ?? null,
    scheduledEnabled: await getSetting("SCHEDULED_BACKUP_ENABLED"),
    intervalMs: CONFIG_SCHEDULED_BACKUP_INTERVAL_MS,
  });
}
