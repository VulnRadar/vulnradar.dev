import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Deliberate breakages of the fixture, each one the exact way a claim of spec
 * 14.1 would be false. `run.mjs --mutate <name>` applies one to the scratch
 * copy of the fixture (never to the sources in the repository), runs the
 * checks that should notice, and reports whether they did.
 *
 * A harness that has only ever printed PASS has not shown it can fail. These
 * are the proof that it can: if a mutation is not detected, the table above
 * it cannot be trusted for the claim that mutation breaks.
 *
 * `edits` are exact, single-occurrence text replacements (selftest.mjs checks
 * that each `from` still occurs exactly once in the fixture). `expectFail`
 * lists the check ids that must report `fail` under the mutation. `target` is
 * `start` only where the claim lives in the build output.
 */
export const MUTATIONS = {
  "no-forwarded-headers": {
    describes: "SPIKE 1: the rewrite is built without { request: { headers } }",
    edits: [
      {
        file: "lib/alias.js",
        from: "return NextResponse.rewrite(destination, init);",
        to: "return NextResponse.rewrite(destination);",
      },
    ],
    expectFail: ["1a", "1b", "1c", "1d"],
  },
  "client-marker-survives": {
    describes:
      "SPIKE 1: a client-sent marker is no longer deleted on page paths",
    edits: [
      {
        file: "middleware.js",
        from: "requestHeaders.delete(MARKER_HEADER);",
        to: "void MARKER_HEADER;",
      },
    ],
    expectFail: ["1e"],
  },
  "host-derived-destination": {
    describes:
      "SPIKE 2: the destination is built from the Host header (what S11 forbids)",
    edits: [
      {
        file: "lib/alias.js",
        from: "const destination = request.nextUrl.clone();\n  destination.pathname = canonicalPath;",
        to: 'const destination = new URL(canonicalPath, `http://${request.headers.get("x-forwarded-host") ?? request.headers.get("host")}`);',
      },
    ],
    expectFail: ["2c", "2d"],
  },
  "path-reencoded": {
    describes:
      "SPIKE 2: the canonical path is percent-encoded a second time, so a%20b arrives as a%20b",
    edits: [
      {
        file: "lib/alias.js",
        from: "to: `/api/${target}/${tail}` };",
        to: "to: `/api/${target}/${encodeURI(tail)}` };",
      },
    ],
    expectFail: ["2a"],
  },
  "query-not-seen": {
    describes: "SPIKE 3: the handler is not given the query string",
    edits: [
      {
        file: "lib/echo.js",
        from: "searchParams: [...request.nextUrl.searchParams.entries()],",
        to: "searchParams: [],",
      },
    ],
    expectFail: ["3c"],
  },
  "body-truncated": {
    describes:
      "SPIKE 3: the handler receives only the first 1000 bytes of a body",
    edits: [
      {
        file: "lib/echo.js",
        from: "const bytes = Buffer.from(await request.arrayBuffer());",
        to: "const bytes = Buffer.from(await request.arrayBuffer()).subarray(0, 1000);",
      },
    ],
    expectFail: ["3b"],
  },
  "stream-buffered": {
    describes: "SPIKE 3: the streamed body is held back until the handler ends",
    edits: [
      {
        file: "lib/echo.js",
        from: "for (let i = 0; i < lines; i++) {",
        to: "const pending = [];\n      for (let i = 0; i < lines; i++) {",
      },
      {
        file: "lib/echo.js",
        from: "controller.enqueue(encoder.encode(makeLine(i)));",
        to: "pending.push(makeLine(i));",
      },
      {
        file: "lib/echo.js",
        from: "controller.close();",
        to: 'controller.enqueue(encoder.encode(pending.join("")));\n      controller.close();',
      },
    ],
    expectFail: ["3d", "3e"],
  },
  "deprecation-header-lost": {
    describes: "SPIKE 4: the middleware never sets Deprecation on the response",
    edits: [
      {
        file: "middleware.js",
        from: 'response.headers.set("Deprecation", DEPRECATION);',
        to: "void DEPRECATION;",
      },
    ],
    expectFail: ["4a", "4b", "4c", "4e"],
  },
  "origin-reflects-host": {
    describes:
      "SPIKE 5: the origin middleware sees would be the client's Host, not the bind address",
    edits: [
      {
        file: "middleware.js",
        from: 'requestHeaders.set("x-spike-mw-url", request.url);',
        to: 'requestHeaders.set("x-spike-mw-url", `https://${request.headers.get("host")}${pathname}`);',
      },
    ],
    expectFail: ["5b"],
  },
  "wrong-max-duration": {
    describes: "SPIKE 6: the destination file exports a different maxDuration",
    target: "start",
    edits: [
      {
        file: "app/api/v4/scan/verify/route.js",
        from: "export const maxDuration = 1140;",
        to: "export const maxDuration = 300;",
      },
    ],
    expectFail: ["6a"],
  },
};

export function applyMutation(workdir, mutation) {
  for (const edit of mutation.edits) {
    const file = path.join(workdir, edit.file);
    const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const count = source.split(edit.from).length - 1;
    if (count !== 1) {
      throw new Error(
        `mutation edit for ${edit.file} matched ${count} times, expected 1: ${edit.from}`,
      );
    }
    writeFileSync(
      file,
      source.replace(edit.from, () => edit.to),
    );
  }
}

/** The SPIKE numbers whose checks a mutation needs to run. */
export function spikesFor(mutation) {
  return [...new Set(mutation.expectFail.map((id) => Number(id[0])))];
}
