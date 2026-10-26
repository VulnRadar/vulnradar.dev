import { verify } from "../lib/report.mjs";

const BIND_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "[::]",
]);

function describe(body) {
  const mw = new URL(body.requestHeaders["x-spike-mw-url"]);
  return {
    handlerUrl: body.url,
    handlerPathname: body.nextUrl.pathname,
    handlerOrigin: body.nextUrl.origin,
    mwUrl: mw.href,
    mwOrigin: mw.origin,
    mwHostname: mw.hostname,
    mwPort: mw.port,
    mwPathname: body.requestHeaders["x-spike-mw-pathname"],
  };
}

export async function run(ctx, report) {
  await report.check(
    {
      id: "5a",
      spike: 5,
      title:
        "inside the handler after a rewrite: request.url and nextUrl.pathname (recorded)",
      required: false,
    },
    async () => {
      const alias = await ctx.req("/api/v3/history/abc/report?x=1");
      const direct = await ctx.req("/api/v4/history/abc/report?x=1");
      if (alias.status !== 200 || direct.status !== 200) {
        return {
          ok: false,
          detail: `alias ${alias.status}, direct ${direct.status}`,
        };
      }
      const a = describe(alias.json());
      const d = describe(direct.json());
      ctx.facts.handlerUrl = {
        alias: { url: a.handlerUrl, nextUrlPathname: a.handlerPathname },
        direct: { url: d.handlerUrl, nextUrlPathname: d.handlerPathname },
      };
      const names =
        a.handlerPathname === "/api/v4/history/abc/report"
          ? "the destination path"
          : a.handlerPathname === "/api/v3/history/abc/report"
            ? "the ORIGINAL alias path"
            : a.handlerPathname;
      return {
        info: `after the rewrite nextUrl.pathname is ${names}; request.url is ${a.handlerUrl} (direct: ${d.handlerUrl})`,
      };
    },
  );

  await report.check(
    {
      id: "5b",
      spike: 5,
      title:
        "inside middleware: request.url origin is the bind address, never the Host",
    },
    async () => {
      const v = verify();
      const internalPort = String(ctx.target.internalPort);
      const hostileNames = ["evil.example", "app.example.test"];
      const observed = [];
      for (const name of hostileNames) {
        const res = await ctx.req("/api/v3/history/abc/report", {
          headers: { host: name, "x-forwarded-host": name },
        });
        if (res.status !== 200) {
          v.expect(false, `Host ${name}: status ${res.status}`);
          continue;
        }
        const d = describe(res.json());
        observed.push(`${d.mwOrigin} (Host ${name})`);
        v.expect(
          d.mwHostname !== name,
          `request.url in middleware reflects the Host header (${d.mwOrigin})`,
        );
        v.expect(
          BIND_HOSTNAMES.has(d.mwHostname),
          `middleware origin host ${d.mwHostname} is not a bind address`,
        );
        v.expect(
          d.mwPort === internalPort,
          `middleware origin port ${d.mwPort || "(default)"}, expected the listen port ${internalPort}`,
        );
        v.expect(
          d.mwPathname === "/api/v3/history/abc/report",
          `middleware saw pathname ${d.mwPathname}`,
        );
      }
      const plain = await ctx.req("/api/v3/history/abc/report", {
        headers: { "x-forwarded-proto": null },
      });
      if (plain.status === 200) {
        const d = describe(plain.json());
        observed.push(`${d.mwOrigin} (no proxy headers)`);
      }
      ctx.facts.middlewareOrigin = observed;
      ctx.facts.mwUrlOrigin = observed[0]?.split(" ")[0];
      return v.result(
        `request.url origin in middleware: ${observed.join("; ")}. A Link or JSON body built from it would carry the bind address, so the compatibility layer builds relative references only`,
      );
    },
  );

  await report.check(
    {
      id: "5c",
      spike: 5,
      title:
        "the origin follows -H, not the HOSTNAME environment variable (recorded)",
      required: false,
    },
    async () => {
      if (ctx.target.mode === "dev")
        return { skip: "next dev is not started with HOSTNAME" };
      if (!ctx.facts.mwUrlOrigin)
        return { ok: false, detail: "5b captured no origin" };
      const hostname = new URL(ctx.facts.mwUrlOrigin).hostname;
      const expected = ctx.target.bind ?? "localhost";
      const setting = `${ctx.target.hostnameEnv ? `HOSTNAME=${ctx.target.hostnameEnv}` : "no HOSTNAME"}, ${ctx.target.bind ? `-H ${ctx.target.bind}` : "no -H"}`;
      if (hostname !== expected) {
        return {
          ok: false,
          detail: `${setting}: middleware origin host is ${hostname}, expected ${expected}`,
        };
      }
      return {
        ok: true,
        detail: ctx.target.bind
          ? `${setting}: middleware origin host is ${hostname}, the -H value`
          : `${setting}: middleware origin host is ${hostname}. next start does not read HOSTNAME (spec 4.5 allows that it might), so the image's HOSTNAME=0.0.0.0 does not move the origin; only -H does`,
      };
    },
  );
}
