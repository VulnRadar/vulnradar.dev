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

export interface PruneOptions {
  /**
   * Basenames that are NEVER deleted, at any depth, and never recursed into
   * (e.g. "node_modules", ".git"). Combined with the .env family, which is
   * always protected.
   */
  protectedNames?: string[];
  /**
   * Root-relative posix prefixes that are NEVER deleted (e.g. "data",
   * "backups", ".next"). These hold user data or expensive-to-rebuild output
   * and must survive an update untouched.
   */
  protectedPrefixes?: string[];
  /**
   * Root-relative posix prefixes to DELETE from the destination even when the
   * release still ships them (e.g. "tests", "LICENSE"). Dev-only files a
   * running install has no reason to keep.
   */
  stripPrefixes?: string[];
  /** Called with the posix relative path of each deleted top-level entry. */
  onDelete?: (relPath: string) => void;
}

export interface PruneResult {
  filesDeleted: number;
  dirsDeleted: number;
  deleted: string[];
}

function matchesPrefix(
  posixRel: string,
  prefixes: string[] | undefined,
): boolean {
  return !!prefixes?.some(
    (prefix) => posixRel === prefix || posixRel.startsWith(`${prefix}/`),
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes files under `destRoot` that the new release (`srcRoot`) no longer
 * ships, turning the additive overlay copy into a real mirror. This is what
 * clears a file that was deleted between releases (e.g. a module renamed away),
 * which an overlay copy would otherwise leave behind to break the next build.
 *
 * A destination entry is deleted when it is NOT protected and either:
 *   - it is in `stripPrefixes` (a dev-only path we always strip), or
 *   - it does not exist in `srcRoot` (stale: removed in the new release).
 *
 * Protected entries (`.env*`, `protectedNames`, `protectedPrefixes`) are never
 * touched and never recursed into. Symlinks are left alone (never deleted,
 * never followed).
 *
 * SAFETY: refuses to run when `srcRoot` has zero entries -- pruning against an
 * empty source would delete every non-protected file in the install. The
 * caller must only invoke this against a freshly-extracted release tree.
 */
export async function pruneExtraneous(
  srcRoot: string,
  destRoot: string,
  options: PruneOptions = {},
): Promise<PruneResult> {
  const srcEntries = await fs.readdir(srcRoot).catch(() => [] as string[]);
  if (srcEntries.length === 0) {
    throw new Error(
      "pruneExtraneous refused: source tree is empty, which would delete the whole install.",
    );
  }

  let filesDeleted = 0;
  let dirsDeleted = 0;
  const deleted: string[] = [];

  function isProtected(posixRel: string, name: string): boolean {
    if (DOTENV_PATTERN.test(name)) return true;
    if (options.protectedNames?.includes(name)) return true;
    return matchesPrefix(posixRel, options.protectedPrefixes);
  }

  async function walk(relDir: string): Promise<void> {
    const entries = await fs.readdir(path.join(destRoot, relDir), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
      const posixRel = toPosix(relPath);

      // Never touch protected paths, and never descend into them.
      if (isProtected(posixRel, entry.name)) continue;

      // Leave symlinks entirely alone (don't delete, don't follow).
      if (entry.isSymbolicLink()) continue;

      const stripped = matchesPrefix(posixRel, options.stripPrefixes);
      const inSource =
        !stripped && (await pathExists(path.join(srcRoot, relPath)));

      if (stripped || !inSource) {
        // Stale (gone from the release) or a dev-only path we strip: remove it.
        await fs.rm(path.join(destRoot, relPath), {
          recursive: true,
          force: true,
        });
        if (entry.isDirectory()) dirsDeleted++;
        else filesDeleted++;
        deleted.push(posixRel);
        options.onDelete?.(posixRel);
        continue;
      }

      // Present in the release: recurse into directories to prune their
      // stale contents; keep files (the overlay copy already refreshed them).
      if (entry.isDirectory()) await walk(relPath);
    }
  }

  await walk("");
  return { filesDeleted, dirsDeleted, deleted };
}
