// Recovery for a page that outlived a deploy.
//
// Each release replaces the container, and with it every hashed file under
// /_next/static. A tab opened before the deploy still asks for the old names
// the first time it lazily loads a chunk (opening a dialog, a client-side
// navigation that needs a new route's code), gets a 404, and lands on an
// error boundary with "Something went wrong" for a page that is fine. Next's
// router already does a full reload when a navigation response comes from a
// different build; this covers the lazy loads it does not see.
//
// The fix is the reload a person would do anyway, done once: a fresh document
// names the new chunks. The guard stops a genuinely missing chunk from
// reloading in a loop.

const RELOAD_KEY = "vr_stale_chunk_reload_at";
const RELOAD_GUARD_MS = 30_000;

/** True for the errors webpack and the browser raise for a chunk that is gone. */
export function isStaleChunkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return (
    typeof message === "string" &&
    /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
      message,
    )
  );
}

interface ReloadDeps {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  reload: () => void;
  now: number;
}

function browserDeps(): ReloadDeps | null {
  if (typeof window === "undefined") return null;
  let storage: ReloadDeps["storage"] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return { storage, reload: () => window.location.reload(), now: Date.now() };
}

/**
 * Reloads the page if `error` is a stale chunk and no such reload happened in
 * the last 30 seconds. Returns whether it reloaded, so the caller can skip
 * rendering an error the reader will never see. Without sessionStorage it
 * does nothing: with no way to remember the first reload, a second one could
 * be a loop.
 */
export function reloadOnceForStaleChunk(
  error: unknown,
  deps: ReloadDeps | null = browserDeps(),
): boolean {
  if (!deps?.storage || !isStaleChunkError(error)) return false;
  try {
    const last = Number(deps.storage.getItem(RELOAD_KEY) ?? 0);
    if (deps.now - last < RELOAD_GUARD_MS) return false;
    deps.storage.setItem(RELOAD_KEY, String(deps.now));
  } catch {
    return false;
  }
  deps.reload();
  return true;
}
