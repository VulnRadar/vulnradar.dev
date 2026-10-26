import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LEGACY_V3_TAILS,
  PERMALINKS,
  V4_ROUTES,
} from "@/lib/api/route-registry";
import {
  REPO_ROOT,
  listApiRouteFiles,
  readPre40Routes,
  readRouteMoves,
  templateOfRouteFile,
} from "../_helpers/api-routes";

/**
 * The inventory of every API route file as it was before the 4.0.0 move.
 *
 * tests/fixtures/api-routes-pre-4.0.json is written once by
 * scripts/maintenance/snapshot-api-routes.mjs and never regenerated: it is the
 * list of URLs that must keep answering after the files move. These tests keep
 * it honest (nobody quietly rewrites it) and keep the tree accounted for
 * against it (no route file appears or disappears without the moves map
 * saying so).
 */

// Hash of the fixture with line endings normalised. If this fails, the
// fixture was edited or regenerated: restore it from git instead of
// updating the hash.
const FIXTURE_SHA256 =
  "bab3c850ae6c88a66ab109b826c563247cc2e411288e46fdaafb3ff5f844a316";

const rows = readPre40Routes();
const moves = readRouteMoves();
const onDisk = (file: string) =>
  existsSync(join(REPO_ROOT, ...file.split("/")));

describe("the pre-4.0 fixture", () => {
  it("has not been edited or regenerated", () => {
    const text = readFileSync(
      join(REPO_ROOT, "tests", "fixtures", "api-routes-pre-4.0.json"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      FIXTURE_SHA256,
    );
  });

  it("lists 170 route files: 168 under /api/v3 and the two unversioned ones", () => {
    expect(rows).toHaveLength(170);
    expect(rows.filter((r) => r.template.startsWith("/api/v3/"))).toHaveLength(
      168,
    );
    expect(
      rows
        .filter((r) => !r.template.startsWith("/api/v3/"))
        .map((r) => r.template)
        .sort(),
    ).toEqual(["/api/security-txt", "/api/version"]);
  });

  it("is sorted, with unique files and unique templates, and every row names a method", () => {
    const files = rows.map((r) => r.file);
    expect(files).toEqual([...files].sort());
    expect(new Set(files).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.template)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.methods.length, row.file).toBeGreaterThan(0);
      for (const method of row.methods) {
        expect([
          "GET",
          "HEAD",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "OPTIONS",
        ]).toContain(method);
      }
    }
  });

  it("agrees with the template the tree helper derives from each path", () => {
    for (const row of rows) {
      expect(
        templateOfRouteFile(join(REPO_ROOT, ...row.file.split("/"))),
        row.file,
      ).toBe(row.template);
    }
  });
});

describe("the fixture against the registry", () => {
  const v3 = rows.filter((r) => r.template.startsWith("/api/v3/"));
  const permalinkTemplates = new Set(PERMALINKS.map((link) => link.template));
  const tailOf = (template: string) => template.slice("/api/v3".length);

  it("has a route file for every permalink", () => {
    const templates = new Set(rows.map((r) => r.template));
    for (const template of permalinkTemplates) {
      expect(templates.has(template), template).toBe(true);
    }
  });

  it("splits the 168 v3 files into 10 permalinks and the 158 legacy tails", () => {
    const permalinks = v3.filter((r) => permalinkTemplates.has(r.template));
    const rest = v3.filter((r) => !permalinkTemplates.has(r.template));
    expect(permalinks).toHaveLength(10);
    expect(rest).toHaveLength(158);
    expect(rest.map((r) => tailOf(r.template)).sort()).toEqual(
      [...LEGACY_V3_TAILS].sort(),
    );
  });

  it("finds 18 existing routes behind the v4 rows (the 19th, openapi.json, is new) and 140 internal ones", () => {
    const legacy = new Set<string>(LEGACY_V3_TAILS);
    const existing = V4_ROUTES.filter((r) => r.template !== "/openapi.json");
    expect(existing).toHaveLength(18);
    for (const route of existing) {
      expect(legacy.has(route.template), route.template).toBe(true);
    }
    const v4Templates = new Set(existing.map((r) => r.template));
    const internal = [...legacy].filter((tail) => !v4Templates.has(tail));
    expect(internal).toHaveLength(140);
  });

  it("gives each v4 row the methods its route file exported", () => {
    for (const route of V4_ROUTES) {
      const row = v3.find((r) => tailOf(r.template) === route.template);
      if (!row) continue;
      expect(Object.keys(route.operations).sort(), route.template).toEqual(
        [...row.methods].sort(),
      );
    }
  });
});

describe("the tree against the fixture and the moves map", () => {
  const diskFiles = listApiRouteFiles().map((f) => f.file);
  const fixtureFiles = new Set(rows.map((r) => r.file));
  const destinations = new Set(Object.values(moves.moves));
  const newRoutes = new Set(moves.newRoutes);

  it("keeps a moves map of the shape the Move writes", () => {
    expect(Object.keys(moves).sort()).toEqual(["moves", "newRoutes"]);
    expect(typeof moves.moves).toBe("object");
    expect(Array.isArray(moves.newRoutes)).toBe(true);
  });

  it("finds every fixture route on disk, or at the place the moves map says it went", () => {
    const missing = rows
      .filter((row) => {
        const where = moves.moves[row.file] ?? row.file;
        return !onDisk(where);
      })
      .map((row) => row.file);
    expect(missing).toEqual([]);
  });

  it("has every moves destination on disk, and no moved source left behind", () => {
    for (const [from, to] of Object.entries(moves.moves)) {
      expect(fixtureFiles.has(from), `${from} is not a pre-4.0 route`).toBe(
        true,
      );
      expect(onDisk(to), `${to} should exist`).toBe(true);
      if (from !== to)
        expect(onDisk(from), `${from} should be gone`).toBe(false);
    }
  });

  it("accounts for every route file on disk: pre-existing, a move destination, or listed as new", () => {
    const unaccounted = diskFiles.filter(
      (file) =>
        !fixtureFiles.has(file) &&
        !destinations.has(file) &&
        !newRoutes.has(file),
    );
    expect(
      unaccounted,
      "A route file that did not exist before 4.0.0 must be added to newRoutes in tests/fixtures/api-route-moves.json (the catch-all, the v4 auth/me and openapi routes, history/resolve and the like). A moved file belongs in moves, written by the move script.",
    ).toEqual([]);
  });

  it("lists as new only files that exist and were not in the fixture", () => {
    for (const file of moves.newRoutes) {
      expect(onDisk(file), `${file} should exist`).toBe(true);
      expect(fixtureFiles.has(file), `${file} is a pre-4.0 route`).toBe(false);
      expect(destinations.has(file), `${file} is a move destination`).toBe(
        false,
      );
    }
    expect(new Set(moves.newRoutes).size).toBe(moves.newRoutes.length);
  });
});

describe("the maintenance scripts", () => {
  const run = (script: string, ...args: string[]) =>
    execFileSync(
      process.execPath,
      [join(REPO_ROOT, "scripts", "maintenance", script), ...args],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 },
    );

  it("snapshot-api-routes still reads the tree", () => {
    expect(run("snapshot-api-routes.mjs", "--dry-run")).toMatch(
      /^Would write \d+ routes to tests\/fixtures\/api-routes-pre-4\.0\.json/,
    );
  }, 60_000);

  it("snapshot-openapi-v3 still builds the document, so the Move can run it", () => {
    expect(run("snapshot-openapi-v3.mjs", "--dry-run")).toMatch(
      /^Would write lib\/api\/openapi-v3\.snapshot\.json: \d+ paths, \d+ operations/,
    );
  }, 60_000);
});
