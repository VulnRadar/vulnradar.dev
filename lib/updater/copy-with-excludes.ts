/**
 * Overlay-copies an extracted release tree onto the running app's
 * directory. Deliberately additive, never a mirror/sync: it only ever
 * creates or overwrites files that exist in `srcRoot`. It never deletes
 * anything under `destRoot` that isn't part of the update.
 *
 * That "overlay, not mirror" behavior is itself most of why .env,
 * node_modules/, .git/, and the avatar upload directory survive an
 * update: `srcRoot` is a `git archive` of a tagged commit, so it
 * structurally never contains any of those paths in the first place (see
 * .github/workflows/release.yml -- git archive only ever includes
 * tracked files, and .env (plus node_modules) is gitignored, never committed).
 * The explicit excludes below are defense in depth for that assumption,
 * not the only thing standing between an update and a wiped .env file.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface CopyExcludeOptions {
  /** Basenames excluded anywhere in the tree, e.g. ["node_modules", ".git"]. */
  excludeNames?: string[];
  /** Relative-path (posix-style, "/" separated) prefixes excluded anywhere in the tree. */
  excludePrefixes?: string[];
  /** Called after each file is copied, with its path relative to srcRoot. */
  onFile?: (relPath: string) => void;
}

export interface CopyResult {
  filesCopied: number;
  dirsCreated: number;
  skipped: string[];
}

const DOTENV_PATTERN = /^\.env(\..+)?$/;

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

function isExcluded(
  relPath: string,
  name: string,
  options: CopyExcludeOptions,
): boolean {
  if (DOTENV_PATTERN.test(name)) return true;
  if (options.excludeNames?.includes(name)) return true;
  const posixRel = toPosix(relPath);
  if (
    options.excludePrefixes?.some(
      (prefix) => posixRel === prefix || posixRel.startsWith(`${prefix}/`),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Copies every file under `srcRoot` into the matching path under
 * `destRoot`, skipping anything excluded. Symlinks are skipped (not
 * followed, not recreated) -- a source tree built by `git archive` of
 * this repo shouldn't contain any, and silently dereferencing an
 * unexpected one is a worse failure mode than refusing it.
 */
export async function copyTreeOverlay(
  srcRoot: string,
  destRoot: string,
  options: CopyExcludeOptions = {},
): Promise<CopyResult> {
  let filesCopied = 0;
  let dirsCreated = 0;
  const skipped: string[] = [];

  async function walk(relDir: string): Promise<void> {
    const entries = await fs.readdir(path.join(srcRoot, relDir), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
      if (isExcluded(relPath, entry.name, options)) {
        skipped.push(toPosix(relPath));
        continue;
      }

      const srcPath = path.join(srcRoot, relPath);
      const destPath = path.join(destRoot, relPath);

      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        dirsCreated++;
        await walk(relPath);
      } else if (entry.isFile()) {
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(srcPath, destPath);
        filesCopied++;
        options.onFile?.(toPosix(relPath));
      }
      // Symlinks and other special entries: intentionally skipped.
    }
  }

  await walk("");
  return { filesCopied, dirsCreated, skipped };
}
