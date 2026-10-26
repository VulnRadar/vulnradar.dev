import { createHash, randomBytes } from "node:crypto";
import { profileStream } from "../lib/http.mjs";
import { verify } from "../lib/report.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const STREAM_LINES = 8;
const STREAM_GAP_MS = 300;

/** What the handler saw of a request, minus the fields that name the path. */
function view(res) {
  const body = res.json();
  return {
    status: res.status,
    method: body.method,
    params: body.params,
    search: body.nextUrl.search,
    searchParams: body.searchParams,
    body: body.body,
    contentType: body.requestHeaders["content-type"],
  };
}

async function sendBoth(ctx, spec) {
  const alias = await ctx.req(
    `/api/v3/history/abc${spec.suffix ?? ""}`,
    spec.options,
  );
  const direct = await ctx.req(
    `/api/v4/history/abc${spec.suffix ?? ""}`,
    spec.options,
  );
  return { alias, direct };
}

async function methods(ctx) {
  const v = verify();
  const payload = JSON.stringify({ ids: [1, 2, 3], note: "café ✓" });
  for (const method of [
    "GET",
    "HEAD",
    "OPTIONS",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
  ]) {
    const hasBody = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const { alias, direct } = await sendBoth(ctx, {
      options: {
        method,
        headers: hasBody ? { "content-type": "application/json" } : {},
        body: hasBody ? payload : undefined,
      },
    });
    v.expect(
      alias.status === direct.status,
      `${method}: alias status ${alias.status}, direct ${direct.status}`,
    );
    if (method === "OPTIONS") {
      v.expect(
        alias.headers.allow === direct.headers.allow,
        `OPTIONS: Allow ${alias.headers.allow} vs ${direct.headers.allow}`,
      );
      continue;
    }
    if (method === "HEAD") {
      v.expect(alias.body.length === 0, "HEAD: the alias response has a body");
      continue;
    }
    if (alias.status !== 200 || direct.status !== 200) continue;
    const a = view(alias);
    const d = view(direct);
    v.expect(a.method === method, `${method}: handler saw ${a.method}`);
    v.expect(
      JSON.stringify(a) === JSON.stringify(d),
      `${method}: alias ${JSON.stringify(a)} differs from direct ${JSON.stringify(d)}`,
    );
    if (hasBody) {
      v.expect(
        a.body?.sha256 === sha256(Buffer.from(payload)),
        `${method}: body digest differs from what was sent`,
      );
    }
  }
  return v.result(
    "GET, HEAD, OPTIONS, POST, PUT, PATCH and DELETE (with a body) behave like the direct route",
  );
}

async function bodies(ctx) {
  const v = verify();
  const big = randomBytes(1024 * 1024);
  const cases = [
    {
      label: "1 MiB binary, Content-Length",
      method: "POST",
      body: big,
      headers: { "content-type": "application/octet-stream" },
    },
    {
      label: "1 MiB binary, chunked",
      method: "POST",
      body: big,
      chunked: true,
      headers: { "content-type": "application/octet-stream" },
    },
    {
      label: "1 MiB binary, DELETE",
      method: "DELETE",
      body: big,
      headers: { "content-type": "application/octet-stream" },
    },
    {
      label: "unicode JSON, PATCH",
      method: "PATCH",
      body: Buffer.from(JSON.stringify({ t: "é✓😀" })),
      headers: { "content-type": "application/json" },
    },
    {
      label: "1 byte",
      method: "POST",
      body: Buffer.from("x"),
      headers: { "content-type": "text/plain" },
    },
    {
      label: "empty body",
      method: "POST",
      body: Buffer.alloc(0),
      headers: { "content-type": "text/plain" },
    },
  ];
  for (const c of cases) {
    const { alias, direct } = await sendBoth(ctx, {
      options: {
        method: c.method,
        headers: c.headers,
        body: c.body,
        chunked: c.chunked,
      },
    });
    if (alias.status !== 200 || direct.status !== 200) {
      v.expect(
        false,
        `${c.label}: status alias ${alias.status}, direct ${direct.status}`,
      );
      continue;
    }
    const a = alias.json().body;
    const d = direct.json().body;
    const want = sha256(c.body);
    v.expect(
      a.sha256 === want,
      `${c.label}: alias digest ${a.sha256?.slice(0, 12)}, sent ${want.slice(0, 12)}`,
    );
    v.expect(
      a.bytes === c.body.length,
      `${c.label}: alias received ${a.bytes} bytes of ${c.body.length}`,
    );
    v.expect(
      d.sha256 === want,
      `${c.label}: direct digest differs (the baseline itself loses bytes)`,
    );
  }
  return v.result(
    "1 MiB bodies (Content-Length and chunked), DELETE with a body, unicode and empty bodies arrive byte for byte",
  );
}

const QUERIES = [
  "?a=1&a=2&b=",
  "?q=%E2%9C%93&sp=a%20b&plus=a+b",
  "?enc=%2F%3F%26%3D%23&novalue",
  "?x=%25%32%35&y=%7E&z=a%2Bb",
  "?long=" + "v".repeat(4000),
];

/**
 * Next re-serialises the query string before middleware sees it (`%20`
 * becomes `+`, a bare `novalue` becomes `novalue=`), for a direct request as
 * much as for an alias. What has to survive a rewrite is the decoded content,
 * and that the alias hands the handler exactly what the direct route gets.
 */
async function queries(ctx) {
  const v = verify();
  const normalised = [];
  for (const q of QUERIES) {
    const label = q.slice(0, 40);
    const { alias, direct } = await sendBoth(ctx, { suffix: `/report${q}` });
    if (alias.status !== 200 || direct.status !== 200) {
      v.expect(
        false,
        `${label}: status alias ${alias.status}, direct ${direct.status}`,
      );
      continue;
    }
    const a = view(alias);
    const d = view(direct);
    const sent = [...new URLSearchParams(q.slice(1))];
    v.expect(
      JSON.stringify(a.searchParams) === JSON.stringify(sent),
      `${label}: decoded pairs ${JSON.stringify(a.searchParams).slice(0, 80)}, sent ${JSON.stringify(sent).slice(0, 80)}`,
    );
    v.expect(
      a.search === d.search,
      `${label}: handler search ${a.search.slice(0, 60)} differs from the direct route's ${d.search.slice(0, 60)}`,
    );
    if (a.search !== q) normalised.push(label);
  }
  ctx.facts.queryReserialised = normalised;
  return v.result(
    `${QUERIES.length} query strings decode to the pairs that were sent and match the direct route${normalised.length ? `; Next re-serialised ${normalised.length} of them for alias and direct alike` : ""}`,
  );
}

async function streamProfiles(ctx, path, options) {
  const alias = await ctx.req(path.alias, options);
  const direct = await ctx.req(path.direct, options);
  const spec = { lines: STREAM_LINES, gapMs: STREAM_GAP_MS };
  return {
    alias,
    direct,
    a: profileStream(alias, spec),
    d: profileStream(direct, spec),
  };
}

async function stream(ctx, { id, label, path, options, expectLine }) {
  const r = await streamProfiles(ctx, path, options);
  ctx.shared.streams = { ...ctx.shared.streams, [id]: r.alias };
  const v = verify();
  v.expect(r.alias.status === 200, `status ${r.alias.status}`);
  v.expect(
    r.d.unbuffered,
    `the direct route is already buffered here (${JSON.stringify(r.d)}), so the baseline cannot show the rewrite's effect`,
  );
  v.expect(
    r.a.unbuffered,
    `the alias is buffered: ${JSON.stringify(r.a)} (direct: ${JSON.stringify(r.d)})`,
  );
  if (expectLine)
    v.expect(
      expectLine(r.alias.text()),
      "the streamed body is not the expected shape",
    );
  return v.result(
    `${label}: first chunk at ${r.a.firstByteMs} ms, ${r.a.chunkCount} chunks spread over ${r.a.spreadMs} ms (direct: ${r.d.chunkCount} over ${r.d.spreadMs} ms)`,
  );
}

export async function run(ctx, report) {
  await report.check(
    {
      id: "3a",
      spike: 3,
      title: "every method reaches the destination handler unchanged",
    },
    () => methods(ctx),
  );

  await report.check(
    { id: "3b", spike: 3, title: "request bodies survive byte for byte" },
    () => bodies(ctx),
  );

  await report.check(
    { id: "3c", spike: 3, title: "query strings and percent-encoding survive" },
    () => queries(ctx),
  );

  await report.check(
    {
      id: "3d",
      spike: 3,
      title: "the NDJSON stream is not buffered (ai/chat stand-in)",
    },
    () =>
      stream(ctx, {
        id: "ndjson",
        label: "NDJSON",
        path: { alias: "/api/v3/ai/chat", direct: "/api/internal/ai/chat" },
        options: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"messages":[]}',
        },
        expectLine: (text) =>
          text
            .trim()
            .split("\n")
            .every((l) => JSON.parse(l).i >= 0),
      }),
  );

  await report.check(
    {
      id: "3e",
      spike: 3,
      title: "the CSV stream is not buffered (audit-log/export stand-in)",
    },
    () =>
      stream(ctx, {
        id: "csv",
        label: "CSV",
        path: {
          alias: "/api/v3/admin/audit-log/export",
          direct: "/api/internal/admin/audit-log/export",
        },
        options: { method: "GET" },
        expectLine: (text) => text.startsWith("id,at,actor\n"),
      }),
  );

  await report.check(
    {
      id: "3f",
      spike: 3,
      title: "streams stay unbuffered when the client asks for gzip",
      required: false,
    },
    async () => {
      const r = await streamProfiles(
        ctx,
        { alias: "/api/v3/ai/chat", direct: "/api/internal/ai/chat" },
        {
          method: "POST",
          headers: {
            "accept-encoding": "gzip",
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      const detail = `gzip: alias ${JSON.stringify(r.a)}, direct ${JSON.stringify(r.d)}`;
      return { ok: r.a.unbuffered === r.d.unbuffered, detail };
    },
  );
}
