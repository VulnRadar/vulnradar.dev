import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { listApiRouteFiles, readRouteMoves } from "../_helpers/api-routes";

/**
 * A route that calls request.json() itself reads a chunked body with no
 * limit. server.mjs caps those bytes for `npm start` and the image, but an
 * install that runs the app some other way (`next start`, a platform's own
 * server) has only the middleware check, which reads the declared
 * Content-Length and nothing else. readJsonObject and parseBody count the
 * bytes themselves, so they hold everywhere.
 *
 * The files below predate the rule. The list only shrinks: a file that stops
 * making the call is printed so it can be removed, and never fails, so moving
 * a route onto readJsonObject needs no edit here.
 *
 * Keyed by the pre-4.0 route file, through tests/fixtures/api-route-moves.json,
 * so moving a route to /api/v4 or /api/internal keeps its entry.
 */
const BASELINE: readonly string[] = [
  "app/api/v3/account/ai-config/route.ts",
  "app/api/v3/account/discord/route.ts",
  "app/api/v3/account/github/repos/route.ts",
  "app/api/v3/account/unsubscribe/route.ts",
  "app/api/v3/admin/activity/route.ts",
  "app/api/v3/admin/engine-feedback/ai-tag-candidates/route.ts",
  "app/api/v3/admin/queue-status/cancel/route.ts",
  "app/api/v3/admin/route.ts",
  "app/api/v3/ai/chat/route.ts",
  "app/api/v3/ai/feedback/route.ts",
  "app/api/v3/auth/2fa/email-send/route.ts",
  "app/api/v3/auth/2fa/email-setup/route.ts",
  "app/api/v3/auth/discord/route.ts",
  "app/api/v3/auth/oauth/[provider]/route.ts",
  "app/api/v3/auth/sessions/ipv4/route.ts",
  "app/api/v3/badge/site/route.ts",
  "app/api/v3/history/[id]/share/publicly-listed/route.ts",
  "app/api/v3/history/[id]/share/route.ts",
  "app/api/v3/scan/authenticated/route.ts",
  "app/api/v3/scan/feedback/route.ts",
  "app/api/v3/scan/github-issue/route.ts",
  "app/api/v3/scan/github/route.ts",
  "app/api/v3/scan/import-spec/route.ts",
];

const RAW_RECEIVERS = new Set(["request", "req"]);

/** Most route files never mention it, and those are not worth parsing. */
const MENTIONS_RAW_CALL = /\b(?:request|req)\s*\.\s*json\s*\(/;

/**
 * Lines with a `request.json()` or `req.json()` call, read from the syntax
 * tree so a comment or a string that mentions one does not count.
 */
function rawJsonCallLines(source: string): number[] {
  if (!MENTIONS_RAW_CALL.test(source)) return [];
  const file = ts.createSourceFile(
    "route.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "json" &&
      ts.isIdentifier(node.expression.expression) &&
      RAW_RECEIVERS.has(node.expression.expression.text)
    ) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

interface RatchetResult {
  /** "file:line" for each call in a file the baseline does not list. */
  offenders: string[];
  /** Baseline entries whose route no longer makes the call. */
  stale: string[];
}

/**
 * @param routes  current route files with their source
 * @param moves   pre-4.0 file -> the file that serves it now
 */
function checkRatchet(
  routes: readonly { file: string; source: string }[],
  baseline: readonly string[],
  moves: Record<string, string>,
): RatchetResult {
  const pre40KeysOf = new Map<string, string[]>();
  for (const [oldFile, newFile] of Object.entries(moves)) {
    pre40KeysOf.set(newFile, [...(pre40KeysOf.get(newFile) ?? []), oldFile]);
  }
  const listed = new Set(baseline);
  const stillCalling = new Set<string>();
  const offenders: string[] = [];

  for (const { file, source } of routes) {
    const lines = rawJsonCallLines(source);
    if (lines.length === 0) continue;
    const keys = [file, ...(pre40KeysOf.get(file) ?? [])];
    const allowed = keys.filter((key) => listed.has(key));
    if (allowed.length > 0) {
      for (const key of allowed) stillCalling.add(key);
      continue;
    }
    for (const line of lines) offenders.push(`${file}:${line}`);
  }

  return {
    offenders,
    stale: baseline.filter((entry) => !stillCalling.has(entry)),
  };
}

describe("no new raw request.json() in a route", () => {
  it("finds no call outside the baseline", () => {
    const routes = listApiRouteFiles().map((route) => ({
      file: route.file,
      source: readFileSync(route.abs, "utf8"),
    }));
    const { offenders, stale } = checkRatchet(
      routes,
      BASELINE,
      readRouteMoves().moves,
    );

    if (stale.length > 0) {
      console.info(
        `These no longer call request.json() and can come off the baseline in tests/repo/no-raw-request-json.test.ts:\n  ${stale.join("\n  ")}`,
      );
    }
    expect(
      offenders,
      "Read the body with readJsonObject or parseBody from lib/api/api-utils.ts: they stop at MAX_REQUEST_BODY_BYTES, and request.json() reads all of a chunked body.",
    ).toEqual([]);
  });

  it("keeps the baseline sorted and free of repeats", () => {
    expect([...BASELINE]).toEqual([...new Set(BASELINE)].sort());
  });
});

describe("the ratchet itself", () => {
  const raw = `export async function POST(request: Request) {\n  const body = await request.json();\n  return Response.json(body);\n}\n`;

  it("fails a raw call in a file that is not listed", () => {
    const result = checkRatchet(
      [{ file: "app/api/v3/new-thing/route.ts", source: raw }],
      ["app/api/v3/old-thing/route.ts"],
      {},
    );
    expect(result.offenders).toEqual(["app/api/v3/new-thing/route.ts:2"]);
  });

  it("counts req.json() as well", () => {
    const result = checkRatchet(
      [
        {
          file: "app/api/v3/a/route.ts",
          source: raw.replace(/request/g, "req"),
        },
      ],
      [],
      {},
    );
    expect(result.offenders).toEqual(["app/api/v3/a/route.ts:2"]);
  });

  it("ignores a call named only in a comment or a string", () => {
    const quiet = `// request.json() would read it all\nexport const note = "req.json()";\n`;
    expect(
      checkRatchet([{ file: "app/api/v3/a/route.ts", source: quiet }], [], {})
        .offenders,
    ).toEqual([]);
  });

  it("follows a listed route to where it moved", () => {
    const result = checkRatchet(
      [{ file: "app/api/v4/thing/route.ts", source: raw }],
      ["app/api/v3/thing/route.ts"],
      { "app/api/v3/thing/route.ts": "app/api/v4/thing/route.ts" },
    );
    expect(result).toEqual({ offenders: [], stale: [] });
  });

  it("reports a listed file that stopped making the call without failing", () => {
    const result = checkRatchet(
      [
        {
          file: "app/api/v3/thing/route.ts",
          source: "export const x = 1;\n",
        },
      ],
      ["app/api/v3/thing/route.ts", "app/api/v3/gone/route.ts"],
      {},
    );
    expect(result).toEqual({
      offenders: [],
      stale: ["app/api/v3/thing/route.ts", "app/api/v3/gone/route.ts"],
    });
  });
});
