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
// names the new chunks. Two guards stop a genuinely missing chunk from
// reloading in a loop: never twice within 30 seconds, and never more than
// three times in one tab's session, because a chunk request can take longer
// than 30 seconds to fail on a slow connection.

const RELOAD_KEY = "vr_stale_chunk_reload";
const RELOAD_GUARD_MS = 30_000;
const MAX_RELOADS_PER_SESSION = 3;

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
 * Reloads the page if `error` is a stale chunk, no such reload happened in the
 * last 30 seconds, and this tab has not already reloaded three times for it.
 * Returns whether it reloaded, so the caller can skip logging an error the
 * reader will never see. Without sessionStorage it does nothing: with no way
 * to remember the first reload, a second one could be a loop.
 */
export function reloadOnceForStaleChunk(
  error: unknown,
  deps: ReloadDeps | null = browserDeps(),
): boolean {
  if (!deps?.storage || !isStaleChunkError(error)) return false;
  try {
    const [at = 0, count = 0] = (deps.storage.getItem(RELOAD_KEY) ?? "")
      .split(":")
      .map(Number);
    if (count >= MAX_RELOADS_PER_SESSION) return false;
    if (deps.now - at < RELOAD_GUARD_MS) return false;
    deps.storage.setItem(RELOAD_KEY, `${deps.now}:${count + 1}`);
  } catch {
    return false;
  }
  deps.reload();
  return true;
}
