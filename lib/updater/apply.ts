/**
 * Orchestrates a self-update: resolve the release -> download -> verify
 * checksum -> verify cosign signature (if available) -> extract -> copy
 * over the running app directory -> npm ci -> npm run build -> npm run
 * db:migrate. Never restarts anything -- the last log line always tells
 * the admin to restart manually.
 *
 * Every subprocess is spawned with an explicit argv array (see
 * lib/updater/exec.ts) and a bounded timeout. The checksum check is a
 * hard gate; cosign is a soft gate only when the binary itself is
 * missing (see lib/updater/cosign.ts) -- an actual signature mismatch
 * still aborts the update.
 */

import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import {
  resolveRelease,
  findAsset,
  downloadReleaseAsset,
} from "@/lib/updater/github-release";
import { verifyChecksum } from "@/lib/updater/checksum";
import { verifyCosignSignature } from "@/lib/updater/cosign";
import { commandAvailable, runCommand } from "@/lib/updater/exec";
import { copyTreeOverlay } from "@/lib/updater/copy-with-excludes";
import { reapplyStartPort } from "@/lib/updater/preserve-start-port";
import { getAvatarStorageDir } from "@/lib/uploads/avatar-storage";
import {
  appendLog,
  setStatus,
  setStep,
  setCosignResult,
  finishJob,
} from "@/lib/updater/job-store";
import { getSettings } from "@/lib/config/runtime-config";

const MAX_TARBALL_BYTES = 200 * 1024 * 1024; // generous ceiling for a source-only tarball
const MAX_SMALL_ASSET_BYTES = 2 * 1024 * 1024; // sums file + cosign bundle are tiny

const NPM_MIGRATE_TIMEOUT_MS = 5 * 60 * 1000;
const TAR_EXTRACT_TIMEOUT_MS = 2 * 60 * 1000;

export class UpdaterError extends Error {}

export async function runUpdateJob(
  jobId: string,
  targetVersion: string,
): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  let workDir: string | null = null;
  // Which step was in flight when/if the catch block below fires. Every
  // "running" transition updates this, so an exception thrown mid-step
  // (network error, disk-full during the file copy, an unexpected
  // exit) always gets attributed to a real step name instead of leaving
  // that step stuck at "running" forever -- which is exactly what made
  // the admin UI's "don't restart, files are half-copied" warning
  // silently never fire on the one failure it exists to catch: a
  // mid-copy error had no explicit setStep(..., "failed", ...) of its
  // own, same as resolve-release/download/extract's non-exit-code
  // failure paths below.
  let currentStepName: string | null = null;
  function startStep(name: string) {
    currentStepName = name;
    setStep(jobId, name, "running");
  }

  try {
    setStatus(jobId, "downloading");
    startStep("resolve-release");
    const release = await resolveRelease(targetVersion);
    if (!release) {
      throw new UpdaterError(
        `Could not find a GitHub release for "${targetVersion}".`,
      );
    }
    setStep(jobId, "resolve-release", "done", release.tagName);
    log(`Resolved release ${release.tagName}`);

    const tarballName = `vulnradar-${release.tagName}.tar.gz`;
    const tarballAsset = findAsset(release, tarballName);
    const sumsAsset = findAsset(release, "sha256sums.txt");
    const certAsset = findAsset(release, `${tarballName}.cert`);

    if (!tarballAsset) {
      throw new UpdaterError(
        `Release ${release.tagName} has no ${tarballName} asset.`,
      );
    }
    if (!sumsAsset) {
      throw new UpdaterError(
        `Release ${release.tagName} has no sha256sums.txt asset.`,
      );
    }

    startStep("download");
    log(`Downloading ${tarballAsset.name} (${tarballAsset.size} bytes)...`);
    const [tarballBuf, sumsBuf] = await Promise.all([
      downloadReleaseAsset(tarballAsset, MAX_TARBALL_BYTES),
      downloadReleaseAsset(sumsAsset, MAX_SMALL_ASSET_BYTES),
    ]);
    const certBuf = certAsset
      ? await downloadReleaseAsset(certAsset, MAX_SMALL_ASSET_BYTES)
      : null;
    setStep(jobId, "download", "done");
    log("Download complete.");

    setStatus(jobId, "verifying");
    startStep("checksum");
    const checksumResult = verifyChecksum(
      tarballBuf,
      sumsBuf.toString("utf8"),
      tarballAsset.name,
    );
    if (!checksumResult.ok) {
      setStep(jobId, "checksum", "failed", checksumResult.error);
      throw new UpdaterError(
        checksumResult.error || "Checksum verification failed.",
      );
    }
    setStep(jobId, "checksum", "done", `sha256:${checksumResult.actual}`);
    log(`Checksum OK: ${checksumResult.actual}`);

    // Write to disk -- cosign and tar both operate on real files.
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "vulnradar-update-"));
    const tarballPath = path.join(workDir, tarballAsset.name);
    await fs.writeFile(tarballPath, tarballBuf);

    startStep("signature");
    if (certBuf) {
      const certPath = path.join(workDir, `${tarballAsset.name}.cert`);
      await fs.writeFile(certPath, certBuf);
      const cosignResult = await verifyCosignSignature({
        bundlePath: certPath,
        tarballPath,
      });
      if (!cosignResult.attempted) {
        setStep(jobId, "signature", "skipped", cosignResult.error);
        setCosignResult(jobId, "skipped");
        log(`Signature verification skipped: ${cosignResult.error}`);
      } else if (!cosignResult.ok) {
        setStep(jobId, "signature", "failed", cosignResult.error);
        setCosignResult(jobId, "failed");
        throw new UpdaterError(
          `cosign signature verification failed: ${cosignResult.error}`,
        );
      } else {
        setStep(jobId, "signature", "done");
        setCosignResult(jobId, "verified");
        log("cosign signature verified.");
      }
    } else {
      setStep(
        jobId,
        "signature",
        "skipped",
        "Release has no .cert signature bundle.",
      );
      setCosignResult(jobId, "skipped");
      log("No cosign signature bundle on this release; skipping.");
    }

    setStatus(jobId, "extracting");
    startStep("extract");
    const tarAvailable = await commandAvailable("tar", ["--version"]);
    if (!tarAvailable) {
      throw new UpdaterError(
        "`tar` was not found on this host. Install it (e.g. `apk add tar` on Alpine, `apt-get install tar` on Debian/Ubuntu) and try again.",
      );
    }
    const extractDir = path.join(workDir, "extracted");
    await fs.mkdir(extractDir, { recursive: true });
    const extractResult = await runCommand(
      "tar",
      ["-xzf", tarballPath, "-C", extractDir],
      {
        timeoutMs: TAR_EXTRACT_TIMEOUT_MS,
        onOutput: (chunk) => log(chunk.trimEnd()),
      },
    );
    if (extractResult.code !== 0) {
      throw new UpdaterError(
        `tar extraction failed (exit code ${extractResult.code}).`,
      );
    }
    const extractedEntries = await fs.readdir(extractDir, {
      withFileTypes: true,
    });
    const rootDirs = extractedEntries.filter((e) => e.isDirectory());
    if (rootDirs.length !== 1) {
      throw new UpdaterError(
        `Expected exactly one top-level directory in the release tarball, found ${rootDirs.length}.`,
      );
    }
    const sourceRoot = path.join(extractDir, rootDirs[0].name);
    setStep(jobId, "extract", "done", rootDirs[0].name);
    log(`Extracted to ${sourceRoot}`);

    setStatus(jobId, "installing");
    startStep("copy");
    const appRoot = process.cwd();

    // Read the CURRENT start script before the overlay copy below replaces
    // package.json wholesale, so a self-hoster's own customized port (most
    // commonly -p on a Pterodactyl-style host that assigns a fixed port)
    // can be reapplied afterward instead of silently reverting to the
    // release's own default. See preserve-start-port.ts's own comment for
    // why the actually-robust fix is a PORT env var, not this -- this is
    // the safety net for anyone who hasn't switched to that yet.
    let oldStartScript: string | undefined;
    try {
      const oldPkgRaw = await fs.readFile(
        path.join(appRoot, "package.json"),
        "utf8",
      );
      oldStartScript = JSON.parse(oldPkgRaw)?.scripts?.start;
    } catch {
      /* first run, or an unreadable/malformed package.json -- nothing to preserve */
    }

    const avatarsDir = getAvatarStorageDir();
    const avatarsRelative = path.relative(appRoot, avatarsDir);
    // Dev-only trees that `npm ci` / `npm run build` / `npm run db:migrate`
    // never read: excluding them keeps the copy fast and keeps a
    // production install free of things that have no reason to be there
    // (test suites, the separate browser-extension product, CI config).
    // Root-level prefixes only -- unlike node_modules/.git below, none of
    // these are excluded by bare name, so a legitimately-needed directory
    // elsewhere in the tree that happens to share a name is never at risk.
    const DEV_ONLY_PREFIXES = [
      "tests",
      ".github",
      "extension",
      ".claude",
      "vitest.config.ts",
    ];
    const excludePrefixes = [".git", "node_modules", ...DEV_ONLY_PREFIXES];
    if (
      !avatarsRelative.startsWith("..") &&
      !path.isAbsolute(avatarsRelative)
    ) {
      excludePrefixes.push(avatarsRelative.split(path.sep).join("/"));
    }
    const copyResult = await copyTreeOverlay(sourceRoot, appRoot, {
      excludeNames: [".git", "node_modules"],
      excludePrefixes,
    });
    setStep(jobId, "copy", "done", `${copyResult.filesCopied} files`);
    log(
      `Copied ${copyResult.filesCopied} files, created ${copyResult.dirsCreated} directories, skipped ${copyResult.skipped.length} excluded paths.`,
    );

    // Reapply a customized start-script port the copy above just
    // overwrote, unless the new release's own start script already
    // specifies one (a real new default always wins over restoring the
    // old value).
    try {
      const pkgPath = path.join(appRoot, "package.json");
      const pkgRaw = await fs.readFile(pkgPath, "utf8");
      const pkg = JSON.parse(pkgRaw);
      const { script, preservedPort } = reapplyStartPort(
        oldStartScript,
        pkg.scripts?.start ?? "next start",
      );
      if (preservedPort) {
        pkg.scripts.start = script;
        await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
        log(
          `Reapplied custom start port -p ${preservedPort} (the update would otherwise have reverted it to the release default).`,
        );
      }
    } catch (err) {
      log(
        `Could not check for a custom start-script port to preserve (non-fatal): ${err instanceof Error ? err.message : err}`,
      );
    }

    const {
      UPDATER_NPM_CI_TIMEOUT_MS: npmCiTimeoutMs,
      UPDATER_NPM_BUILD_TIMEOUT_MS: npmBuildTimeoutMs,
    } = await getSettings([
      "UPDATER_NPM_CI_TIMEOUT_MS",
      "UPDATER_NPM_BUILD_TIMEOUT_MS",
    ] as const);

    startStep("npm-ci");
    const ciResult = await runCommand("npm", ["ci"], {
      cwd: appRoot,
      timeoutMs: npmCiTimeoutMs,
      onOutput: (chunk) => log(chunk.trimEnd()),
    });
    if (ciResult.code !== 0) {
      setStep(jobId, "npm-ci", "failed", `exit ${ciResult.code}`);
      throw new UpdaterError(
        `npm ci failed (exit code ${ciResult.code}${ciResult.timedOut ? ", timed out" : ""}).`,
      );
    }
    setStep(jobId, "npm-ci", "done");

    setStatus(jobId, "building");
    startStep("npm-build");
    const buildResult = await runCommand("npm", ["run", "build"], {
      cwd: appRoot,
      timeoutMs: npmBuildTimeoutMs,
      onOutput: (chunk) => log(chunk.trimEnd()),
    });
    if (buildResult.code !== 0) {
      setStep(jobId, "npm-build", "failed", `exit ${buildResult.code}`);
      throw new UpdaterError(
        `npm run build failed (exit code ${buildResult.code}${buildResult.timedOut ? ", timed out" : ""}).`,
      );
    }
    setStep(jobId, "npm-build", "done");

    setStatus(jobId, "migrating");
    startStep("db-migrate");
    // --yes: explicit, not just relying on this spawned child having no
    // TTY (true, but implicit) -- migrate.mjs's interactive prompts
    // (database picker, target version, destructive-step confirmation)
    // would otherwise hang until NPM_MIGRATE_TIMEOUT_MS and always fail
    // this step. See _lib.prompts.mjs's NON_INTERACTIVE for exactly what
    // this does and doesn't auto-answer -- a downgrade still always
    // refuses to run unattended.
    const migrateResult = await runCommand(
      "npm",
      ["run", "db:migrate", "--", "--yes"],
      {
        cwd: appRoot,
        timeoutMs: NPM_MIGRATE_TIMEOUT_MS,
        onOutput: (chunk) => log(chunk.trimEnd()),
      },
    );
    if (migrateResult.code !== 0) {
      setStep(jobId, "db-migrate", "failed", `exit ${migrateResult.code}`);
      throw new UpdaterError(
        `npm run db:migrate failed (exit code ${migrateResult.code}${migrateResult.timedOut ? ", timed out" : ""}).`,
      );
    }
    setStep(jobId, "db-migrate", "done");

    log(
      `Update to ${release.tagName} applied. Restart your server process to run the new version.`,
    );
    finishJob(jobId, "completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (currentStepName) {
      setStep(jobId, currentStepName, "failed", message);
    }
    appendLog(jobId, `ERROR: ${message}`);
    finishJob(jobId, "failed", message);
  } finally {
    if (workDir) {
      const dir = workDir;
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
