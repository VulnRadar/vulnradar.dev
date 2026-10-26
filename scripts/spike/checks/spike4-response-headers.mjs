import { createHash } from "node:crypto";
import { parseLinkHeader } from "../lib/http.mjs";
import { verify } from "../lib/report.mjs";

const EXPECTED = {
  deprecation: "@1798761600",
  sunset: "Thu, 01 Jul 2027 00:00:00 GMT",
};

/** The bytes fixture/lib/echo.js binaryReport() produces, from the same formula. */
function binaryReport(size = 65536) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0xfe], 0);
  return Buffer.from(bytes);
}

function middlewareHeaderProblems(res, label, v, { successor } = {}) {
  v.expect(
    res.headers.deprecation === EXPECTED.deprecation,
    `${label}: Deprecation is ${res.headers.deprecation}`,
  );
  v.expect(
    res.headers.sunset === EXPECTED.sunset,
    `${label}: Sunset is ${res.headers.sunset}`,
  );
  const links = parseLinkHeader(res.headers.link);
  const rels = links.map((l) => l.params.rel);
  v.expect(
    rels.includes("deprecation"),
    `${label}: Link has no rel=deprecation (${res.headers.link})`,
  );
  const deprecation = links.find((l) => l.params.rel === "deprecation");
  v.expect(
    !deprecation ||
      (deprecation.target === "/docs/api/migrate-v4" &&
        deprecation.params.type === "text/html"),
    `${label}: deprecation link is ${JSON.stringify(deprecation)}`,
  );
  if (successor) {
    const next = links.find((l) => l.params.rel === "successor-version");
    v.expect(
      next?.target === successor,
      `${label}: successor-version is ${next?.target}, expected ${successor}`,
    );
  }
  v.expect(
    /^[0-9a-f-]{36}$/.test(res.headers["x-request-id"] ?? ""),
    `${label}: x-request-id is ${res.headers["x-request-id"]}`,
  );
  v.expect(
    (res.headers["content-security-policy"] ?? "").includes("'nonce-"),
    `${label}: CSP lost its nonce`,
  );
  v.expect(
    res.headers["strict-transport-security"] !== undefined,
    `${label}: HSTS missing`,
  );
  for (const name of [
    "deprecation",
    "sunset",
    "x-request-id",
    "content-security-policy",
  ]) {
    v.expect(
      res.headerLines(name) === 1,
      `${label}: ${name} arrived on ${res.headerLines(name)} header lines`,
    );
  }
}

const SUCCESSOR = "/api/v4/history/abc/report";

export async function run(ctx, report) {
  await report.check(
    {
      id: "4a",
      spike: 4,
      title:
        "success: Deprecation, Sunset, Link, CSP and x-request-id reach the client",
    },
    async () => {
      const v = verify();
      const res = await ctx.req("/api/v3/history/abc/report");
      v.expect(res.status === 200, `status ${res.status}`);
      middlewareHeaderProblems(res, "200", v, { successor: SUCCESSOR });
      return v.result(
        `Link arrived as ${JSON.stringify(res.headers.link)} on ${res.headerLines("link")} header line(s)`,
      );
    },
  );

  await report.check(
    {
      id: "4b",
      spike: 4,
      title:
        "handler errors (401, 429, 500): middleware headers added, handler headers kept",
    },
    async () => {
      const v = verify();
      const cases = [
        {
          fail: "429",
          status: 429,
          keep: { "retry-after": "7", "x-ratelimit-remaining": "0" },
        },
        {
          fail: "401",
          status: 401,
          keep: { "www-authenticate": 'Bearer realm="VulnRadar"' },
        },
        { fail: "500", status: 500, keep: {} },
      ];
      for (const c of cases) {
        const res = await ctx.req(`/api/v3/history/abc/report?fail=${c.fail}`);
        v.expect(res.status === c.status, `${c.fail}: status ${res.status}`);
        middlewareHeaderProblems(res, c.fail, v, { successor: SUCCESSOR });
        for (const [name, value] of Object.entries(c.keep)) {
          v.expect(
            res.headers[name] === value,
            `${c.fail}: handler header ${name} is ${res.headers[name]}`,
          );
        }
        v.expect(res.json().code !== undefined, `${c.fail}: handler body lost`);
      }
      return v.result(
        "Retry-After and WWW-Authenticate survive next to the middleware headers",
      );
    },
  );

  await report.check(
    {
      id: "4c",
      spike: 4,
      title:
        "binary body (PDF): bytes untouched, handler and middleware headers both present",
    },
    async () => {
      const v = verify();
      const res = await ctx.req("/api/v3/history/abc/report?format=pdf");
      const direct = await ctx.req("/api/v4/history/abc/report?format=pdf");
      const want = binaryReport();
      v.expect(res.status === 200, `status ${res.status}`);
      v.expect(
        res.headers["content-type"] === "application/pdf",
        `content-type ${res.headers["content-type"]}`,
      );
      v.expect(
        res.headers["content-disposition"] ===
          'attachment; filename="report.pdf"',
        `content-disposition ${res.headers["content-disposition"]}`,
      );
      v.expect(
        createHash("sha256").update(res.body).digest("hex") ===
          createHash("sha256").update(want).digest("hex"),
        `body differs (${res.body.length} of ${want.length} bytes)`,
      );
      v.expect(
        res.headers["content-length"] === direct.headers["content-length"],
        `content-length ${res.headers["content-length"]} differs from the direct route's ${direct.headers["content-length"]}`,
      );
      v.expect(
        res.headers["transfer-encoding"] ===
          direct.headers["transfer-encoding"],
        `transfer-encoding ${res.headers["transfer-encoding"]} differs from the direct route's ${direct.headers["transfer-encoding"]}`,
      );
      middlewareHeaderProblems(res, "pdf", v, { successor: SUCCESSOR });
      ctx.facts.binaryFraming = res.headers["content-length"]
        ? "content-length"
        : (res.headers["transfer-encoding"] ?? "none");
      return v.result(
        `${want.length} binary bytes and the Content-Disposition arrive with the middleware headers (framing: ${ctx.facts.binaryFraming}, as on the direct route)`,
      );
    },
  );

  await report.check(
    {
      id: "4d",
      spike: 4,
      title: "streamed bodies (NDJSON, CSV) carry the middleware headers",
    },
    async () => {
      const v = verify();
      const streams = ctx.shared.streams ?? {};
      for (const key of ["ndjson", "csv"]) {
        if (!streams[key]) {
          v.expect(
            false,
            `${key}: no streamed response captured (SPIKE 3 did not run)`,
          );
          continue;
        }
        middlewareHeaderProblems(streams[key], key, v);
      }
      return v.result(
        "Deprecation, Sunset, Link, CSP and x-request-id are on both streams",
      );
    },
  );

  await report.check(
    {
      id: "4e",
      spike: 4,
      title:
        "alias to an internal route gets the headers, without a successor link",
    },
    async () => {
      const v = verify();
      const res = await ctx.req("/api/v3/echo");
      v.expect(res.status === 200, `status ${res.status}`);
      middlewareHeaderProblems(res, "internal", v);
      const rels = parseLinkHeader(res.headers.link).map((l) => l.params.rel);
      v.expect(
        !rels.includes("successor-version"),
        "an internal alias advertised a successor-version link",
      );
      return v.result("only the deprecation link");
    },
  );

  await report.check(
    {
      id: "4f",
      spike: 4,
      title: "a handler that throws still gets the middleware headers",
      required: false,
    },
    async () => {
      const v = verify();
      const res = await ctx.req("/api/v3/history/abc/report?fail=throw");
      v.expect(res.status >= 500, `status ${res.status}`);
      middlewareHeaderProblems(res, "throw", v, { successor: SUCCESSOR });
      return v.result(
        `status ${res.status}; withErrorHandling catches everything first, so this is the backstop`,
      );
    },
  );

  await report.check(
    {
      id: "4h",
      spike: 4,
      title:
        "Next adds x-middleware-rewrite to the client response (recorded, not graded)",
      required: false,
    },
    async () => {
      const aliased = await ctx.req("/api/v3/history/abc/report?x=1");
      const internal = await ctx.req("/api/v3/echo");
      const direct = await ctx.req("/api/v4/history/abc/report?x=1");
      return {
        info: `alias to v4: ${JSON.stringify(aliased.headers["x-middleware-rewrite"] ?? null)}; alias to internal: ${JSON.stringify(internal.headers["x-middleware-rewrite"] ?? null)}; direct: ${JSON.stringify(direct.headers["x-middleware-rewrite"] ?? null)}`,
      };
    },
  );

  await report.check(
    {
      id: "4g",
      spike: 4,
      title:
        "a header the handler also sets: which side wins (recorded, not graded)",
      required: false,
    },
    async () => {
      const winners = (res) => {
        const links = parseLinkHeader(res.headers.link);
        const pick = (name, handlerValue) =>
          `${name}: ${res.headers[name] === handlerValue ? "handler wins" : "middleware wins"}`;
        return [
          pick("x-request-id", "handler-chosen"),
          pick("content-security-policy", "default-src 'none'"),
          pick("deprecation", "handler"),
          `link: ${links.some((l) => l.target === "https://handler.invalid/") ? "handler's link kept" : "handler's link dropped"}`,
        ].join(", ");
      };
      const aliased = await ctx.req("/api/v3/history/abc/report?collide=1");
      const direct = await ctx.req("/api/v4/history/abc/report?collide=1");
      ctx.facts.headerCollision = {
        alias: winners(aliased),
        direct: winners(direct),
      };
      return {
        info: `alias: ${winners(aliased)}. direct (no rewrite): ${winners(direct)}`,
      };
    },
  );
}
