/**
 * The self-updater overlay-copies the new release's package.json straight
 * over the running app's own (see copy-with-excludes.ts -- package.json
 * isn't in any exclude list), which wipes out a self-hoster's own
 * customized "start" script on every update. The most common case: a
 * hardcoded -p/--port flag, since some hosts (Pterodactyl-style panels
 * that assign a specific port per instance) don't always make it
 * convenient to inject a PORT environment variable instead. `next start`
 * already reads process.env.PORT natively with zero code changes needed,
 * which survives every future update since the updater never touches env
 * vars, only the source tree -- that's the actually-robust fix, and worth
 * switching to. This module is the safety net for anyone who hasn't:
 * it detects a custom port on the OLD "start" script before the copy step
 * runs, and reapplies it to the NEW one afterward, but only the port,
 * not "anything different" -- restoring an entire old script wholesale
 * risks reintroducing something genuinely incompatible with the new
 * release, which a single flag can't.
 */

const PORT_FLAG_RE = /(?:^|\s)(?:-p|--port)(?:=|\s+)(\d+)/;

export function extractStartPort(
  startScript: string | undefined | null,
): string | null {
  if (!startScript) return null;
  const match = PORT_FLAG_RE.exec(startScript);
  return match ? match[1] : null;
}

export interface ReapplyStartPortResult {
  /** The start script to write. Unchanged from `newStartScript` if there was nothing to preserve. */
  script: string;
  /** The port that was reapplied, or null if nothing needed preserving. */
  preservedPort: string | null;
}

/**
 * Reapplies the old start script's port flag onto the new one, unless
 * there was no custom port to begin with, or the new script already
 * specifies its own port -- a real new default always wins over blindly
 * restoring the old value.
 */
export function reapplyStartPort(
  oldStartScript: string | undefined | null,
  newStartScript: string,
): ReapplyStartPortResult {
  const oldPort = extractStartPort(oldStartScript);
  const newPort = extractStartPort(newStartScript);
  if (!oldPort || newPort) {
    return { script: newStartScript, preservedPort: null };
  }
  return {
    script: `${newStartScript.trim()} -p ${oldPort}`,
    preservedPort: oldPort,
  };
}
