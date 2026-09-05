import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Whether this deployment can run the self-update flow at all.
 *
 * Three questions, in order, and only the first two can refuse:
 *
 * VERCEL is always set on Vercel's serverless platform, whose filesystem is
 * read-only outside /tmp and reset between invocations, so rewriting the
 * running app's own files there is not possible (and pointless: new versions
 * ship there via git push, not a runtime file overwrite).
 *
 * VULNRADAR_UPDATER_DISABLED is set by our own Dockerfile. An image-based
 * install updates by pulling a new image, and a file the updater wrote into
 * the container's writable layer is discarded the moment it does, so even a
 * run that fully succeeded would be undone without a word. That is a fact
 * about how the copy is delivered, which no filesystem probe can see, so the
 * image states it.
 *
 * Then the only question left is whether the update could actually be
 * applied, which is asked by trying it: can this process create a new entry
 * in the directory it would be writing into?
 *
 * What this deliberately does NOT do is ask whether it is in a container.
 * It used to, via /.dockerenv and /run/.containerenv, and that was wrong in
 * a way worth spelling out because the marker files are so tempting.
 *
 * The failure being prevented (AUDIT-014#host-08) was specific: inside our
 * official image the updater offered the button, then failed with EACCES
 * partway through, after package.json had already been overwritten, leaving
 * the version string describing code that is not installed. The cause is that
 * WORKDIR /app is created by root while the process runs as uid 1001, so the
 * process cannot create new top-level entries there. That is a permissions
 * fact, and the fix read it as a container fact.
 *
 * Every container carries /.dockerenv, so that reading also caught every
 * install that runs VulnRadar from source inside one: Pterodactyl and Pelican
 * eggs, unRAID, and hand-rolled setups. Those have a writable, persistent app
 * directory owned by the user the process runs as, the updater worked there
 * for eight releases, and 3.8.0 told them all to run `docker compose pull`
 * against a deployment that has no image to pull. Asking the question that
 * was actually meant answers both correctly.
 */
export function isUpdaterSupported(): { supported: boolean; reason?: string } {
  if (process.env.VERCEL) {
    return {
      supported: false,
      reason:
        "The updater rewrites the running app's files on disk, which isn't possible on Vercel's read-only serverless filesystem. Deploy new versions there via git push instead.",
    };
  }

  if (process.env.VULNRADAR_UPDATER_DISABLED === "true") {
    return {
      supported: false,
      reason:
        "This build updates by pulling a new image: anything written into the running container is discarded the moment you do, so an in-place update here would be undone without a word. Update with `docker compose pull && docker compose up -d` instead.",
    };
  }

  const appDir = process.cwd();
  if (!canCreateEntriesIn(appDir)) {
    return {
      supported: false,
      reason: `The app directory (${appDir}) is not writable by the user this process runs as, so an update would fail part way through, after it had already overwritten files in place. Run the update as the user that owns this directory, or, if this copy came from a container image, pull a new image instead.`,
    };
  }

  return { supported: true };
}

/**
 * Can this process create a new entry in `dir`?
 *
 * By creating one, not by asking. That is the exact operation the update
 * performs when it copies the release tree over the app directory, and it is
 * the one that failed: fs.access(W_OK) reports on the permission bits and
 * would have to be trusted to agree with the kernel about a read-only mount,
 * an overlay, or an ACL. Doing it costs two syscalls on an admin request and
 * cannot disagree with what the update will hit.
 *
 * Not memoised. A directory's ownership can change under a running process
 * (a volume remounted, a chown during a migration), and reporting a stale
 * yes would put an admin back in front of the half-applied update this
 * exists to prevent.
 */
function canCreateEntriesIn(dir: string): boolean {
  let probe: string | undefined;
  try {
    probe = mkdtempSync(join(dir, ".vulnradar-update-probe-"));
    return true;
  } catch {
    return false;
  } finally {
    if (probe) {
      try {
        rmSync(probe, { recursive: true, force: true });
      } catch {
        // Left behind only if the directory became unwritable between the
        // two calls. An empty dot-directory is harmless and the next probe
        // makes its own.
      }
    }
  }
}
