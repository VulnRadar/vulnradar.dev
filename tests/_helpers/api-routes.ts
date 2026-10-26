import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the route files are, for the tests that read route sources or walk the
 * tree. About fifteen guard tests used to hard-code `app/api/v3`; once the
 * files move across three directories that would silently shrink what they
 * guard, so they ask this module instead.
 *
 * `api-route-moves.json` maps each pre-4.0 route file to the file that serves
 * it now. It is empty until the move starts, which makes every lookup the
 * identity.
 */

export type ApiSpace = "v3" | "v4" | "internal" | "root";

export interface ApiRouteFile {
  /** Repo-relative, forward slashes: "app/api/v3/history/[id]/route.ts". */
  file: string;
  /** Absolute path. */
  abs: string;
  /** "root" is app/api itself: version, security-txt, the catch-all. */
  space: ApiSpace;
  /** The URL template: "/api/v3/history/:id". A catch-all is "/api/*path". */
  template: string;
}

export interface RouteMoves {
  moves: Record<string, string>;
  newRoutes: string[];
}

/** One row of tests/fixtures/api-routes-pre-4.0.json, the API as it was before the move. */
export interface Pre40Route {
  file: string;
  template: string;
  methods: string[];
}

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const API_DIR = join(REPO_ROOT, "app", "api");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures");
const MOVES_FILE = join(FIXTURES, "api-route-moves.json");
const PRE_40_FILE = join(FIXTURES, "api-routes-pre-4.0.json");

const toPosix = (p: string) => p.split(sep).join("/");

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/^route\.(?:ts|tsx|js|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

export function templateOfRouteFile(file: string): string {
  const dir = toPosix(relative(join(REPO_ROOT, "app"), dirname(file)));
  const segments = dir
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const catchAll = /^\[\[?\.\.\.(\w+)\]?\]$/.exec(segment);
      if (catchAll) return `*${catchAll[1]}`;
      const dynamic = /^\[(\w+)\]$/.exec(segment);
      if (dynamic) return `:${dynamic[1]}`;
      return segment;
    });
  return `/${segments.join("/")}`;
}

function spaceOf(file: string): ApiSpace {
  const rest = toPosix(relative(API_DIR, file));
  const first = rest.split("/")[0];
  return first === "v3" || first === "v4" || first === "internal"
    ? first
    : "root";
}

/** Every route file under app/api, sorted by path. */
export function listApiRouteFiles(
  options: { spaces?: readonly ApiSpace[] } = {},
): ApiRouteFile[] {
  return walk(API_DIR)
    .map((abs) => ({
      file: toPosix(relative(REPO_ROOT, abs)),
      abs,
      space: spaceOf(abs),
      template: templateOfRouteFile(abs),
    }))
    .filter((route) => !options.spaces || options.spaces.includes(route.space))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export function readRouteMoves(): RouteMoves {
  return JSON.parse(readFileSync(MOVES_FILE, "utf8")) as RouteMoves;
}

/** The 170 route files that existed before the move, sorted by file. */
export function readPre40Routes(): Pre40Route[] {
  return JSON.parse(readFileSync(PRE_40_FILE, "utf8")) as Pre40Route[];
}

/**
 * The route file that now serves what `app/api/v3/<oldTail>/route.ts` served
 * before the move, as a repo-relative path. `oldTail` is the directory path
 * with its brackets, for example "scan/status/[id]"; an empty tail is
 * app/api/v3/route.ts. A file that has not moved answers with itself.
 */
export function routeFile(oldTail: string): string {
  const oldFile = oldTail
    ? `app/api/v3/${oldTail}/route.ts`
    : "app/api/v3/route.ts";
  return readRouteMoves().moves[oldFile] ?? oldFile;
}

/** The source text of {@link routeFile}. */
export function routeSource(oldTail: string): string {
  const file = routeFile(oldTail);
  const abs = join(REPO_ROOT, ...file.split("/"));
  if (!existsSync(abs)) {
    throw new Error(`No route file at ${file} (old tail "${oldTail}")`);
  }
  return readFileSync(abs, "utf8");
}
