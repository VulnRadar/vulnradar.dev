import { existsSync } from "node:fs";

/**
 * Whether this deployment can run the self-update flow at all. VERCEL is
 * always set on Vercel's serverless platform, whose filesystem is
 * read-only outside /tmp and reset between invocations, so rewriting the
 * running app's own files there is not possible (and pointless -- new
 * versions ship there via git push, not a runtime file overwrite).
 *
 * Containers are the second case, and used to be missed. Inside the
 * official image the updater reported itself available and the admin UI
 * offered the button, but the job cannot work there: it copies the release
 * tree over process.cwd() (/app), which is root-owned because WORKDIR runs
 * as root while the process runs as uid 1001, so new top-level entries
 * fail with EACCES -- after package.json has already been overwritten in
 * place, leaving the version string describing code that is not installed.
 * Even a clean run then ends with "run npm run build and restart", and in
 * a container the restart is a `docker compose pull` that discards the
 * writable layer entirely. The correct update path there is pulling a new
 * image, so say so instead of offering a button that half-applies
 * (AUDIT-014#host-08).
 *
 * Detection is deliberately belt-and-braces: an explicit env var the image
 * can set, plus the marker files Docker (/.dockerenv) and Podman
 * (/run/.containerenv) create in every container they start. Any one of
 * them is enough.
 */
export function isUpdaterSupported(): { supported: boolean; reason?: string } {
  if (process.env.VERCEL) {
    return {
      supported: false,
      reason:
        "The updater rewrites the running app's files on disk, which isn't possible on Vercel's read-only serverless filesystem. Deploy new versions there via git push instead.",
    };
  }

  if (isContainerEnvironment()) {
    return {
      supported: false,
      reason:
        "This instance is running in a container, where the app directory is not writable by the app user and any change is discarded on the next image pull. Update with `docker compose pull && docker compose up -d` instead.",
    };
  }

  return { supported: true };
}

function isContainerEnvironment(): boolean {
  if (process.env.VULNRADAR_UPDATER_DISABLED === "true") return true;
  if (process.env.CONTAINER === "true") return true;
  try {
    return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
  } catch {
    // A sandboxed filesystem that refuses the stat is not evidence of a
    // container; fall through to "not detected" rather than disabling the
    // updater for a bare-metal install.
    return false;
  }
}
