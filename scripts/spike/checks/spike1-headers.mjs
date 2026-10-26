import { verify } from "../lib/report.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CLIENT_HEADERS = {
  "x-request-id": "client-chosen",
  "x-nonce": "client-nonce",
  "x-vr-api-version": "v4",
  cookie: "session=abc123; other=1",
  authorization: "Bearer spike-token",
};

function forwardedProblems(view, label, v) {
  const id = view["x-request-id"];
  const nonce = view["x-nonce"];
  v.expect(
    typeof id === "string" && UUID.test(id),
    `${label}: x-request-id is not the middleware's UUID (${id})`,
  );
  v.expect(
    typeof nonce === "string" &&
      nonce.length > 8 &&
      nonce !== "client-nonce" &&
      !nonce.includes(","),
    `${label}: x-nonce was not replaced cleanly (${nonce})`,
  );
  v.expect(
    view["x-vr-api-version"] === "v3",
    `${label}: marker is ${JSON.stringify(view["x-vr-api-version"])}, expected "v3" (a client value must be overwritten, not appended)`,
  );
  v.expect(
    view["x-pathname"] === "/api/v4/history/abc",
    `${label}: x-pathname is ${view["x-pathname"]}`,
  );
  v.expect(
    view["x-spike-forwarded"] === "yes",
    `${label}: a plain forwarded header is missing`,
  );
  v.expect(
    view["x-spike-hop"] === "1",
    `${label}: middleware ran ${view["x-spike-hop"]} times for one request`,
  );
}

export async function run(ctx, report) {
  const alias = await ctx.req("/api/v3/history/abc", {
    headers: CLIENT_HEADERS,
  });
  const aliasBody = alias.status === 200 ? alias.json() : null;

  await report.check(
    {
      id: "1a",
      spike: 1,
      title: "alias: forwarded headers arrive in request.headers",
    },
    async () => {
      const v = verify();
      v.expect(alias.status === 200, `status ${alias.status}`);
      if (aliasBody) {
        forwardedProblems(aliasBody.requestHeaders, "request.headers", v);
        v.expect(
          aliasBody.route === "v4-history-id",
          `reached ${aliasBody.route}`,
        );
      }
      return v.result(
        "x-nonce, x-request-id, marker, x-pathname and a custom header all arrive",
      );
    },
  );

  await report.check(
    {
      id: "1b",
      spike: 1,
      title: "alias: the same headers arrive through next/headers",
    },
    async () => {
      const v = verify();
      if (!aliasBody) return { ok: false, detail: `status ${alias.status}` };
      forwardedProblems(aliasBody.nextHeaders, "next/headers", v);
      return v.result("headers() sees the same values as request.headers");
    },
  );

  await report.check(
    {
      id: "1c",
      spike: 1,
      title:
        "one middleware pass: response id and CSP nonce match what the handler saw",
    },
    async () => {
      const v = verify();
      if (!aliasBody) return { ok: false, detail: `status ${alias.status}` };
      const seenId = aliasBody.requestHeaders["x-request-id"];
      const seenNonce = aliasBody.requestHeaders["x-nonce"];
      v.expect(
        alias.headers["x-request-id"] === seenId,
        `response x-request-id ${alias.headers["x-request-id"]} differs from the handler's ${seenId}`,
      );
      v.expect(
        (alias.headers["content-security-policy"] ?? "").includes(
          `'nonce-${seenNonce}'`,
        ),
        "response CSP does not carry the nonce the handler saw",
      );
      return v.result("the id and nonce are one value in request and response");
    },
  );

  await report.check(
    {
      id: "1d",
      spike: 1,
      title:
        "Authorization is deleted for non-v4 targets and kept for v4; Cookie always survives",
    },
    async () => {
      const v = verify();
      const probes = [
        { path: "/api/v3/echo", bearer: false },
        { path: "/api/internal/echo", bearer: false },
        { path: "/api/v3/history/abc", bearer: true },
        { path: "/api/v4/history/abc", bearer: true },
      ];
      for (const probe of probes) {
        const res = await ctx.req(probe.path, { headers: CLIENT_HEADERS });
        if (res.status !== 200) {
          v.expect(false, `${probe.path}: status ${res.status}`);
          continue;
        }
        const body = res.json();
        for (const [view, label] of [
          [body.requestHeaders, "request.headers"],
          [body.nextHeaders, "next/headers"],
        ]) {
          const auth = view.authorization;
          if (probe.bearer) {
            v.expect(
              auth === "Bearer spike-token",
              `${probe.path} ${label}: Authorization is ${auth}, expected it kept`,
            );
          } else {
            v.expect(
              auth === undefined,
              `${probe.path} ${label}: Authorization reached the handler (${auth})`,
            );
          }
          v.expect(
            (view.cookie ?? "").includes("session=abc123"),
            `${probe.path} ${label}: Cookie lost`,
          );
        }
        v.expect(
          body.session === "abc123",
          `${probe.path}: request.cookies lost the session`,
        );
      }
      return v.result(
        "a header the middleware deleted never reaches the handler",
      );
    },
  );

  await report.check(
    {
      id: "1e",
      spike: 1,
      title:
        "page-kind request rewritten into /api by next.config has its client marker deleted",
    },
    async () => {
      const v = verify();
      for (const p of ["/security.txt", "/.well-known/security.txt"]) {
        const res = await ctx.req(p, { headers: { "x-vr-api-version": "v4" } });
        v.expect(res.status === 200, `${p}: status ${res.status}`);
        if (res.status !== 200) continue;
        const body = res.json();
        v.expect(body.route === "security-txt", `${p}: reached ${body.route}`);
        v.expect(
          body.requestHeaders["x-vr-api-version"] === undefined,
          `${p}: client marker reached the handler (${body.requestHeaders["x-vr-api-version"]})`,
        );
      }
      return v.result(
        "a client-chosen marker cannot ride a page path into an API handler",
      );
    },
  );
}
