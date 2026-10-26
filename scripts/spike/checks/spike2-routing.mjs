import { tryRequest } from "../lib/http.mjs";
import { verify } from "../lib/report.mjs";

/** Path ids that exercise raw versus decoded matching. */
const ID_PROBES = [
  "abc",
  "0123456789abcdef0123456789abcdef",
  "12345",
  "a%20b",
  "caf%C3%A9",
  "a%25b",
  "a%2Fb",
  "%E2%9C%93",
  "a.b",
  "a+b",
];

function describeView(res) {
  if (res.status !== 200 && res.status !== 404) return { status: res.status };
  try {
    const body = res.json();
    return {
      status: res.status,
      route: body.route,
      params: body.params,
      search: body.nextUrl?.search,
      searchParams: body.searchParams,
    };
  } catch {
    return { status: res.status, text: res.text().slice(0, 80) };
  }
}

async function paramParity(ctx) {
  const v = verify();
  const seen = [];
  for (const id of ID_PROBES) {
    const query = "?format=json&q=a%20b";
    const alias = await ctx.req(`/api/v3/history/${id}/report${query}`);
    const direct = await ctx.req(`/api/v4/history/${id}/report${query}`);
    const a = describeView(alias);
    const d = describeView(direct);
    if (JSON.stringify(a) !== JSON.stringify(d)) {
      v.expect(
        false,
        `${id}: alias ${JSON.stringify(a)} differs from direct ${JSON.stringify(d)}`,
      );
    }
    seen.push(`${id} -> ${JSON.stringify(a.params?.id ?? a.status)}`);
    if (id === "abc" || /^[0-9a-f]{32}$/.test(id)) {
      v.expect(
        a.params?.id === id,
        `${id}: arrived as ${JSON.stringify(a.params)}`,
      );
    }
  }
  ctx.facts.paramDecoding = seen;
  return v.result(
    `alias equals direct for ${ID_PROBES.length} ids (${seen.join(", ")})`,
  );
}

async function precedence(ctx) {
  const v = verify();
  const cases = [
    {
      path: "/api/v3/static-sibling",
      route: "internal-static-sibling",
      note: "static file beats [...path]",
    },
    {
      path: "/api/v3/badge/scans",
      route: "internal-badge-scans",
      note: "static badge/scans beats badge/[token]",
    },
    {
      path: "/api/v3/badge/abc",
      route: "internal-badge-token",
      note: "badge/[token] beats [...path]",
      params: { token: "abc" },
    },
    {
      path: "/api/v3/no-such-thing/x/y",
      route: "internal-catch-all",
      note: "unknown tail falls into the 404 catch-all",
      status: 404,
      params: { path: ["no-such-thing", "x", "y"] },
    },
  ];
  for (const c of cases) {
    for (const prefix of ["/api/v3", "/api/internal"]) {
      const target = c.path.replace("/api/v3", prefix);
      const res = await ctx.req(target);
      const wantStatus = c.status ?? 200;
      if (res.status !== wantStatus) {
        v.expect(
          false,
          `${target}: status ${res.status}, expected ${wantStatus}`,
        );
        continue;
      }
      const body = res.json();
      v.expect(
        body.route === c.route,
        `${target}: reached ${body.route}, expected ${c.route} (${c.note})`,
      );
      if (c.params) {
        v.expect(
          JSON.stringify(body.params) === JSON.stringify(c.params),
          `${target}: params ${JSON.stringify(body.params)}`,
        );
      }
    }
  }
  return v.result(
    "alias and direct reach the same file in every precedence case",
  );
}

/** Which route each hostile-battery row must be answered by. */
const BATTERY_ROWS = [
  {
    path: "/api/v3/history/abc/report",
    method: "GET",
    route: "v4-history-report",
  },
  {
    path: "/api/v3/history/abc",
    method: "POST",
    route: "v4-history-id",
    body: '{"a":1}',
  },
  {
    path: "/api/v3/history/abc",
    method: "DELETE",
    route: "v4-history-id",
    body: '{"ids":[1,2]}',
  },
  {
    path: "/api/v3/scan/verify",
    method: "POST",
    route: "v4-scan-verify",
    body: '{"u":"x"}',
  },
  { path: "/api/v3/echo", method: "GET", route: "internal-echo" },
  { path: "/api/v3/not-a-route/x", method: "GET", route: "internal-catch-all" },
];

function hostileCombos(name) {
  return [
    { label: "Host", headers: { host: name } },
    { label: "X-Forwarded-Host", headers: { "x-forwarded-host": name } },
    { label: "Host+XFH", headers: { host: name, "x-forwarded-host": name } },
    {
      label: "Host+XFH+proto",
      headers: {
        host: name,
        "x-forwarded-host": name,
        "x-forwarded-proto": "https",
      },
    },
    {
      label: "Forwarded",
      headers: { forwarded: `for=203.0.113.9;host=${name};proto=https` },
    },
  ];
}

async function controlProxied(ctx) {
  const { recorder, recorderHostHeader, controlToken } = ctx.hostile;
  const sendControl = (token) =>
    ctx.req("/api/spike-control/proxy-from-host", {
      method: "POST",
      headers: {
        host: recorderHostHeader,
        cookie: "session=control-cookie",
        authorization: "Bearer control-token",
        "content-type": "text/plain",
        ...(token ? { "x-spike-control": token } : {}),
      },
      body: "control-body",
    });

  // The control is an open proxy on purpose, and the fixture listens on every
  // interface of the machine running the harness. It answers only a caller
  // that holds the per-run token, and this proves a caller without one gets
  // nothing before the real control is sent.
  recorder.reset();
  const tokenless = await sendControl(null);
  const tokenlessRefused =
    tokenless.status === 404 &&
    recorder.requests().length === 0 &&
    recorder.connections() === 0;

  recorder.reset();
  const res = await sendControl(controlToken);
  const seen = recorder.requests();
  const hit = seen.find((r) => r.url?.startsWith("/api/spike-control/target"));
  const forwarded = hit
    ? {
        cookie: hit.headers.cookie === "session=control-cookie",
        authorization: hit.headers.authorization === "Bearer control-token",
        body: hit.bodyBytes === "control-body".length,
      }
    : null;
  ctx.facts.controlProxy = {
    status: res.status,
    recorderRequests: seen.length,
    forwarded,
    tokenlessRefused,
  };
  return {
    proxied: Boolean(hit),
    tokenlessRefused,
    forwarded,
    status: res.status,
    servedLocally: res.headers["x-spike-handler"] === "control-target-local",
  };
}

async function hostileBattery(ctx) {
  const { recorder, recorderHostHeader, evilName } = ctx.hostile;
  const v = verify();
  recorder.reset();
  let sent = 0;
  for (const name of [evilName, recorderHostHeader]) {
    for (const combo of hostileCombos(name)) {
      for (const row of BATTERY_ROWS) {
        const { response, error } = await tryRequest({
          port: ctx.port,
          method: row.method,
          path: row.path,
          headers: {
            "x-forwarded-proto": "https",
            "accept-encoding": "identity",
            ...(row.body ? { "content-type": "application/json" } : {}),
            ...combo.headers,
          },
          body: row.body,
        });
        sent++;
        const label = `${row.method} ${row.path} [${combo.label} ${name}]`;
        if (error) {
          v.expect(false, `${label}: transport error ${error.message}`);
          continue;
        }
        v.expect(
          response.headers["x-spike-handler"] === row.route,
          `${label}: answered by ${response.headers["x-spike-handler"] ?? `status ${response.status}`}, not ${row.route}`,
        );
        if (response.headers["x-spike-recorder"]) {
          v.expect(
            false,
            `${label}: the response came from the hostile listener`,
          );
        }
      }
    }
  }
  const connections = recorder.connections();
  const requests = recorder.requests();
  v.expect(
    connections === 0,
    `the hostile listener accepted ${connections} connection(s)`,
  );
  v.expect(
    requests.length === 0,
    `the hostile listener received ${requests.length} request(s)`,
  );
  return v.result(
    `${sent} hostile requests answered by the handlers, 0 connections to the listener`,
  );
}

const PROTO_VARIANTS = [
  {
    label: "no X-Forwarded-Proto",
    headers: { "x-forwarded-proto": null },
    https: false,
  },
  {
    label: "X-Forwarded-Proto: https",
    headers: { "x-forwarded-proto": "https" },
    https: true,
  },
  {
    label: "X-Forwarded-Proto: http",
    headers: { "x-forwarded-proto": "http" },
    https: false,
  },
  {
    label: "X-Forwarded-Proto: https, http",
    headers: { "x-forwarded-proto": "https, http" },
    https: true,
  },
  {
    label: "https behind a public Host",
    headers: {
      "x-forwarded-proto": "https",
      host: "app.example.test",
      "x-forwarded-host": "app.example.test",
    },
    https: true,
  },
];

async function originsAgree(ctx) {
  const v = verify();
  const facts = [];
  for (const variant of PROTO_VARIANTS) {
    const res = await ctx.req("/api/v3/history/abc/report?x=1", {
      headers: variant.headers,
    });
    if (res.status !== 200) {
      v.expect(false, `${variant.label}: status ${res.status}`);
      continue;
    }
    const body = res.json();
    const hops = body.requestHeaders["x-spike-hop"];
    v.expect(
      body.route === "v4-history-report",
      `${variant.label}: reached ${body.route}`,
    );
    v.expect(
      hops === "1",
      `${variant.label}: middleware ran ${hops} times, so Next proxied the rewrite to itself (the two origins it compares differ)`,
    );
    const rewrite = res.headers["x-middleware-rewrite"];
    if (rewrite !== undefined) {
      v.expect(
        !/^[a-z][a-z0-9+.-]*:/i.test(rewrite),
        `${variant.label}: x-middleware-rewrite is absolute (${rewrite})`,
      );
    }
    const mwOrigin = new URL(body.requestHeaders["x-spike-mw-url"]).origin;
    v.expect(
      mwOrigin.startsWith(variant.https ? "https:" : "http:"),
      `${variant.label}: middleware origin ${mwOrigin} has the wrong protocol`,
    );
    facts.push(
      `${variant.label}: mw origin ${mwOrigin}, hops ${hops}, x-middleware-rewrite ${rewrite === undefined ? "not exposed" : JSON.stringify(rewrite)}`,
    );
  }
  ctx.facts.originAgreement = facts;
  return v.result(
    `no self-proxy in ${PROTO_VARIANTS.length} protocol variants`,
  );
}

export async function run(ctx, report) {
  await report.check(
    {
      id: "2a",
      spike: 2,
      title:
        "params arrive intact across a rewrite (10 ids, raw and percent-encoded)",
    },
    () => paramParity(ctx),
  );

  await report.check(
    {
      id: "2b",
      spike: 2,
      title: "a static sibling beats [token] and [...path] after a rewrite",
    },
    () => precedence(ctx),
  );

  let control = null;
  await report.check(
    {
      id: "2c-control",
      spike: 2,
      title:
        "control: a rewrite built from Host IS proxied to the listener, credentials and body included",
    },
    async () => {
      control = await controlProxied(ctx);
      const v = verify();
      v.expect(
        control.tokenlessRefused,
        "harness defect: the unsafe control answered a request without the per-run token, so anything that can reach this port could use it as a proxy",
      );
      v.expect(
        control.proxied,
        `the listener saw nothing (status ${control.status}, served locally: ${control.servedLocally}); a clean origin result below would prove nothing`,
      );
      if (control.forwarded) {
        v.expect(control.forwarded.cookie, "Cookie was not forwarded");
        v.expect(
          control.forwarded.authorization,
          "Authorization was not forwarded",
        );
        v.expect(control.forwarded.body, "the body was not forwarded");
      }
      return v.result(
        "Next proxied the request, with Cookie, Authorization and the body: this is what S11 prevents",
      );
    },
  );

  await report.check(
    {
      id: "2c",
      spike: 2,
      title:
        "origin assertion: hostile Host and X-Forwarded-Host never leave the server",
    },
    async () => {
      if (!control?.proxied) {
        return {
          ok: false,
          detail:
            "inconclusive: the positive control was not proxied, so the listener cannot be trusted to see a leak",
        };
      }
      return hostileBattery(ctx);
    },
  );

  await report.check(
    {
      id: "2d",
      spike: 2,
      title:
        "the two origins Next compares agree, with and without X-Forwarded-Proto",
    },
    () => originsAgree(ctx),
  );
}
