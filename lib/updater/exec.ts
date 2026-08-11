/**
 * Safe subprocess execution for the self-update flow.
 *
 * Every call site in lib/updater/ passes the command and its arguments as
 * a plain array (execFile/spawn semantics) and never builds a shell
 * string -- `shell` is always left false, so there is no shell to
 * reinterpret quoting or metacharacters. None of the inputs here are
 * user-controlled today (versions come from a GitHub release tag, paths
 * are server-generated temp dirs), but the whole point of this endpoint
 * is "download and run external code as a super_admin", so argv arrays
 * are kept non-negotiable defense in depth rather than an optimization
 * to skip because "nothing user-controlled reaches it right now".
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export type OutputListener = (
  chunk: string,
  stream: "stdout" | "stderr",
) => void;

/**
 * Runs `command` with `args` (never through a shell), streaming stdout
 * and stderr to `onOutput` as it arrives, and killing the process if it
 * runs longer than `timeoutMs`. Resolves with the exit code/signal even
 * on a non-zero exit -- callers decide what a failing exit code means for
 * their step, this function's job is bounding and observing the process.
 */
export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
    onOutput?: OutputListener;
  },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
    });

    let timedOut = false;
    let settled = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Escalate if the process ignores SIGTERM.
      setTimeout(() => {
        if (!settled) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }
      }, 5000).unref();
    }, options.timeoutMs);
    killTimer.unref();

    child.stdout?.on("data", (chunk: Buffer) => {
      options.onOutput?.(chunk.toString("utf8"), "stdout");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      options.onOutput?.(chunk.toString("utf8"), "stderr");
    });

    child.on("error", (err) => {
      settled = true;
      clearTimeout(killTimer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      settled = true;
      clearTimeout(killTimer);
      resolve({ code, signal, timedOut });
    });
  });
}

/**
 * Existence check for an optional external binary (cosign, tar). Never
 * assumes the tool is installed -- self-hosted hosts vary widely (bare
 * Node, Docker, Pterodactyl-style panels), so this probes by actually
 * trying to run it rather than searching PATH by hand.
 */
export async function commandAvailable(
  command: string,
  versionArgs: string[] = ["--version"],
): Promise<boolean> {
  try {
    await execFileAsync(command, versionArgs, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export { execFileAsync };
