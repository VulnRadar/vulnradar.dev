import type { GithubTreeEntry } from "./github-api";

/**
 * Filters a repo's file tree down to the set of files worth fetching and
 * scanning: skips vendor/build directories and binary-looking extensions,
 * then caps total file count and total bytes so one repo can't turn a
 * scan into an unbounded number of GitHub API calls or an unbounded
 * amount of content sent to the AI reviewer.
 */

const SKIP_DIR_SEGMENTS = new Set([
  "node_modules",
  "vendor",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "target",
  "bin",
  "obj",
  "venv",
  ".venv",
  "__pycache__",
  ".idea",
  ".vscode",
  "coverage",
  ".pytest_cache",
  ".tox",
  "bower_components",
  "packages", // NuGet
  ".terraform",
  ".gradle",
  "cdk.out",
]);

// Extensions treated as binary/non-reviewable, skipped without ever being
// fetched. Not exhaustive by design — anything not recognized as text-ish
// is fetched and only then size-checked, so an unusual-but-valid text
// extension isn't silently dropped.
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svg",
  ".avif",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".mov",
  ".avi",
  ".mkv",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".bz2",
  ".xz",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".class",
  ".jar",
  ".war",
  ".wasm",
  ".pyc",
  ".pyo",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".lock", // package-lock.json etc are text but huge and low-signal; excluded on purpose
  ".map", // source maps: huge, generated, not source
]);

function isInSkippedDir(path: string): boolean {
  const segments = path.split("/");
  // The file's own name is the last segment; every earlier segment is a
  // directory name to check against the skip list.
  return segments.slice(0, -1).some((seg) => SKIP_DIR_SEGMENTS.has(seg));
}

function hasBinaryExtension(path: string): boolean {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return false;
  return BINARY_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

export interface RepoFilterCaps {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

export interface FilteredRepoFiles {
  /** Files selected to fetch and scan, in tree order. */
  selected: GithubTreeEntry[];
  /** How many blob entries existed before filtering (for reporting). */
  totalBlobCount: number;
  /** True if the file cap or byte cap cut the list short. */
  truncatedByCaps: boolean;
}

/**
 * Applies directory/extension/size filtering and the file-count + total-
 * byte caps. Only considers `size` from the tree metadata (already known
 * from the GitHub tree API response) — no content is fetched here, so
 * this is cheap to run before deciding whether a scan is even worth
 * starting.
 */
export function filterScannableFiles(
  entries: GithubTreeEntry[],
  caps: RepoFilterCaps,
): FilteredRepoFiles {
  const blobs = entries.filter((e) => e.type === "blob");

  const candidates = blobs.filter((e) => {
    if (isInSkippedDir(e.path)) return false;
    if (hasBinaryExtension(e.path)) return false;
    if (typeof e.size === "number" && e.size > caps.maxFileBytes) return false;
    return true;
  });

  const selected: GithubTreeEntry[] = [];
  let totalBytes = 0;
  let truncatedByCaps = false;

  for (const entry of candidates) {
    if (selected.length >= caps.maxFiles) {
      truncatedByCaps = true;
      break;
    }
    const size = entry.size ?? 0;
    if (totalBytes + size > caps.maxTotalBytes) {
      truncatedByCaps = true;
      continue; // a later, smaller file might still fit under the byte budget
    }
    selected.push(entry);
    totalBytes += size;
  }

  return { selected, totalBlobCount: blobs.length, truncatedByCaps };
}
