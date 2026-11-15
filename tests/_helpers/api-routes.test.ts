import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const moves = vi.hoisted(() => ({ override: null as string | null }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((path: unknown, ...rest: unknown[]) =>
    moves.override !== null && String(path).endsWith("api-route-moves.json")
      ? moves.override
      : (actual.readFileSync as (...args: unknown[]) => unknown)(
          path,
          ...rest,
        )) as typeof actual.readFileSync;
  return { ...actual, readFileSync };
});

import {
  MUTATING_METHODS,
  REPO_ROOT,
  exportedHttpMethods,
  listApiRouteFiles,
  mutatingHandlers,
  readPre40Routes,
  readRouteMoves,
  routeFile,
  routeSource,
  templateOfRouteFile,
} from "./api-routes";

const routeAt = (...segments: string[]) =>
  join(REPO_ROOT, "app", "api", ...segments, "route.ts");

describe("templateOfRouteFile", () => {
  it("turns directories into a URL template", () => {
    expect(
      templateOfRouteFile(routeAt("v3", "history", "[id]", "report")),
    ).toBe("/api/v3/history/:id/report");
    expect(templateOfRouteFile(routeAt("version"))).toBe("/api/version");
    expect(
      templateOfRouteFile(
        routeAt("v3", "scan", "discover", "progress", "[requestId]"),
      ),
    ).toBe("/api/v3/scan/discover/progress/:requestId");
  });

  it("names a catch-all with a star", () => {
    expect(templateOfRouteFile(routeAt("[...path]"))).toBe("/api/*path");
    expect(templateOfRouteFile(routeAt("[[...path]]"))).toBe("/api/*path");
  });
});

describe("listApiRouteFiles", () => {
  const files = listApiRouteFiles();

  it("lists every route file with forward slashes, sorted", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => f.file)).toEqual(files.map((f) => f.file).sort());
    for (const route of files) {
      expect(route.file).toMatch(/^app\/api\/.+\/route\.(?:ts|tsx|js|mjs)$/);
      expect(route.file).not.toContain("\\");
    }
  });

  it("assigns the space from the directory, and root to files directly under app/api", () => {
    for (const route of files) {
      const first = route.file.split("/")[2];
      const expected =
        first === "v3" || first === "v4" || first === "internal"
          ? first
          : "root";
      expect(route.space, route.file).toBe(expected);
    }
    expect(files.find((f) => f.template === "/api/version")?.space).toBe(
      "root",
    );
  });

  it("derives the template from the path", () => {
    for (const route of files) {
      expect(route.template, route.file).toMatch(/^\/api\//);
      expect(route.template).not.toMatch(/[[\]]/);
    }
  });

  it("filters by space", () => {
    const root = listApiRouteFiles({ spaces: ["root"] });
    expect(root.length).toBeGreaterThan(0);
    expect(root.every((f) => f.space === "root")).toBe(true);
    const some = listApiRouteFiles({ spaces: ["v3", "v4", "internal"] });
    expect(some.length + root.length).toBe(files.length);
    expect(listApiRouteFiles({ spaces: [] })).toEqual([]);
  });
});

describe("routeFile", () => {
  it("answers with the file itself when the moves map has no entry for it", () => {
    moves.override = JSON.stringify({ moves: {}, newRoutes: [] });
    try {
      expect(routeFile("scan/status/[id]")).toBe(
        "app/api/v3/scan/status/[id]/route.ts",
      );
      expect(routeFile("health")).toBe("app/api/v3/health/route.ts");
      expect(routeFile("")).toBe("app/api/v3/route.ts");
    } finally {
      moves.override = null;
    }
  });

  it("reads the committed moves map, which has the two parts the inventory test checks", () => {
    const committed = readRouteMoves();
    expect(Object.keys(committed).sort()).toEqual(["moves", "newRoutes"]);
    expect(Array.isArray(committed.newRoutes)).toBe(true);
  });

  it("reads the source of an unmoved route", () => {
    expect(routeSource("health")).toMatch(
      /export (?:async )?function GET|export const GET/,
    );
  });

  it("follows the moves map and falls back to the identity for everything else", () => {
    moves.override = JSON.stringify({
      moves: {
        "app/api/v3/scan/status/[id]/route.ts":
          "app/api/v4/scan/status/[id]/route.ts",
      },
      newRoutes: [],
    });
    try {
      expect(routeFile("scan/status/[id]")).toBe(
        "app/api/v4/scan/status/[id]/route.ts",
      );
      expect(routeFile("health")).toBe("app/api/v3/health/route.ts");
    } finally {
      moves.override = null;
    }
  });

  it("says which file is missing when the source is not there", () => {
    expect(() => routeSource("no/such/route")).toThrow(
      /app\/api\/v3\/no\/such\/route\/route\.ts/,
    );
  });
});

describe("readPre40Routes", () => {
  it("reads the frozen snapshot", () => {
    const rows = readPre40Routes();
    expect(rows).toHaveLength(170);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        file: expect.stringMatching(/^app\/api\//),
        template: expect.stringMatching(/^\/api\//),
        methods: expect.any(Array),
      }),
    );
  });
});

describe("exportedHttpMethods", () => {
  // A second, plain-text reading of each file. The two disagree only on an
  // export form one of them does not know, which is what this is for.
  const textMethods = (source: string) =>
    ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].filter(
      (m) =>
        new RegExp(
          `^export\\s+(?:async\\s+function|function|const|let)\\s+${m}\\b`,
          "m",
        ).test(source) ||
        new RegExp(
          `^export\\s*\\{[^}]*\\b(?:as\\s+)?${m}\\b[^}]*\\}`,
          "m",
        ).test(source),
    );

  it("agrees with a plain-text reading of every route file", () => {
    const routes = listApiRouteFiles();
    expect(routes.length).toBeGreaterThan(100);
    for (const route of routes) {
      expect(exportedHttpMethods(route.abs), route.file).toEqual(
        textMethods(readFileSync(route.abs, "utf8")),
      );
    }
  });

  it("finds the health check's GET and nothing else", () => {
    expect(exportedHttpMethods(routeAt("v3", "health"))).toEqual(["GET"]);
  });
});

describe("mutatingHandlers", () => {
  it("is every exported POST, PUT, PATCH and DELETE, one row per method", () => {
    const handlers = mutatingHandlers();
    expect(handlers.length).toBeGreaterThan(100);
    for (const h of handlers) expect(MUTATING_METHODS).toContain(h.method);
    const expected = listApiRouteFiles().reduce(
      (n, route) =>
        n +
        exportedHttpMethods(route.abs).filter((m) =>
          MUTATING_METHODS.includes(m),
        ).length,
      0,
    );
    expect(handlers).toHaveLength(expected);
  });
});
