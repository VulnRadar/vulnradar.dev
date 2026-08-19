/**
 * Whether this deployment can run the self-update flow at all. VERCEL is
 * always set on Vercel's serverless platform, whose filesystem is
 * read-only outside /tmp and reset between invocations, so rewriting the
 * running app's own files there is not possible (and pointless -- new
 * versions ship there via git push, not a runtime file overwrite).
 */
export function isUpdaterSupported(): { supported: boolean; reason?: string } {
  if (process.env.VERCEL) {
    return {
      supported: false,
      reason:
        "The updater rewrites the running app's files on disk, which isn't possible on Vercel's read-only serverless filesystem. Deploy new versions there via git push instead.",
    };
  }
  return { supported: true };
}
