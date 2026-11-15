import { describe, it, expect } from "vitest";
import {
  MATCHER_EXPECTATIONS,
  checkMiddlewareBuild,
} from "../../../scripts/ci/next16-build-checks.mjs";

/**
 * The Build job's manifest check (scripts/ci/next16-build-checks.mjs).
 *
 * CI runs it against what Turbopack compiled. Here it runs against what
 * Next's own JavaScript matcher compiler makes of middleware.ts's real
 * config, which proves the expectations are right for the config as written,
 * and against broken manifests, which proves the check can fail.
 */

const { config } = await import("@/middleware");

// Next's JavaScript matcher compiler, the one webpack builds use. It is an
// internal export with no type declaration, so a Next release that moves it
// fails here by name rather than with a type error somewhere else.
const { getMiddlewareMatchers } =
  (await import("next/dist/build/analysis/get-page-static-info.js")) as unknown as {
    getMiddlewareMatchers: (
      matcher: string[],
      nextConfig: object,
    ) => { regexp: string }[];
  };
if (typeof getMiddlewareMatchers !== "function") {
  throw new Error(
    "next/dist/build/analysis/get-page-static-info.js no longer exports getMiddlewareMatchers",
  );
}

function manifestFor(matcher: string[]) {
  return {
    version: 3,
    middleware: {
      "/": {
        page: "/",
        name: "middleware",
        files: [],
        matchers: getMiddlewareMatchers(matcher, {}),
      },
    },
    functions: {},
    sortedMiddleware: ["/"],
  };
}

describe("the Build job's middleware manifest check", () => {
  it("passes the matchers middleware.ts declares", () => {
    const result = checkMiddlewareBuild({
      middlewareManifest: manifestFor(config.matcher),
      functionsConfig: { version: 1, functions: {} },
    });
    expect(result.problems).toEqual([]);
    expect(result.matchers).toBe(config.matcher.length);
  });

  it("covers an image-suffixed API path, an escaped prefix, a page and the static files", () => {
    expect(MATCHER_EXPECTATIONS).toMatchObject({
      "/api/v3/support-tickets/12.png": true,
      "/%61pi/v3/support-tickets/12.png": true,
      "/pricing": true,
      "/_next/static/chunks/x.js": false,
    });
  });

  it("fails when the /api matcher is lost", () => {
    const withoutApi = config.matcher.filter(
      (m: string) => m !== "/api/:path*",
    );
    expect(withoutApi.length).toBe(config.matcher.length - 1);
    const { problems } = checkMiddlewareBuild({
      middlewareManifest: manifestFor(withoutApi),
      functionsConfig: {},
    });
    expect(problems).toEqual([
      "/api/v3/support-tickets/12.png: matched false, expected true",
      "/%61pi/v3/support-tickets/12.png: matched false, expected true",
    ]);
  });

  it("fails when a matcher starts covering the static files", () => {
    const { problems } = checkMiddlewareBuild({
      middlewareManifest: manifestFor(["/:path*"]),
      functionsConfig: {},
    });
    expect(problems).toContain(
      "/_next/static/chunks/x.js: matched true, expected false",
    );
    expect(problems).toContain("/logo.png: matched true, expected false");
  });

  it("fails when middleware was compiled for Node.js", () => {
    const node = checkMiddlewareBuild({
      middlewareManifest: { version: 3, middleware: {}, functions: {} },
      functionsConfig: { version: 1, functions: { "/_middleware": {} } },
    });
    expect(node.problems).toEqual([
      "middleware-manifest.json has no Edge middleware for /",
    ]);

    const both = checkMiddlewareBuild({
      middlewareManifest: manifestFor(config.matcher),
      functionsConfig: { version: 1, functions: { "/_middleware": {} } },
    });
    expect(both.problems).toEqual([
      "middleware was compiled for Node.js: functions-config-manifest.json lists /_middleware",
    ]);
  });

  it("fails on an Edge entry with no matchers", () => {
    const { problems } = checkMiddlewareBuild({
      middlewareManifest: { middleware: { "/": { matchers: [] } } },
      functionsConfig: {},
    });
    expect(problems).toContain("the Edge middleware has no compiled matchers");
  });
});
