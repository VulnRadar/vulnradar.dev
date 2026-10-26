import { verify } from "../lib/report.mjs";

const EXPECTED = 1140;
const DESTINATION = /\/api\/v4\/scan\/verify(\/route)?$/;

export async function run(ctx, report) {
  await report.check(
    {
      id: "6a",
      spike: 6,
      title:
        "the build records maxDuration 1140 for the destination file, and none for the alias",
    },
    async () => {
      const manifest = await ctx.readBuildManifest();
      if (!manifest) {
        // Only `next dev` is allowed to have no manifest. A built target
        // without one (the image reads it through docker exec) must not turn
        // the build-level claim into a skip that the table reads as a pass.
        if (ctx.target.mode !== "dev") {
          return {
            ok: false,
            detail:
              "no functions-config-manifest.json in the build output of a built target",
          };
        }
        return {
          skip: "no build manifest: next dev does not write functions-config-manifest.json",
        };
      }
      const v = verify();
      const keys = Object.keys(manifest.functions ?? {});
      const key = keys.find((k) => DESTINATION.test(k));
      v.expect(
        Boolean(key),
        `no manifest entry for the destination route (keys: ${keys.join(", ") || "none"})`,
      );
      if (key) {
        v.expect(
          manifest.functions[key].maxDuration === EXPECTED,
          `${key} maxDuration is ${manifest.functions[key].maxDuration}`,
        );
      }
      const aliasKeys = keys.filter((k) => k.includes("/api/v3/"));
      v.expect(
        aliasKeys.length === 0,
        `the alias path has its own entry: ${aliasKeys.join(", ")}`,
      );
      return v.result(
        `${key}: maxDuration ${EXPECTED}, from the destination's own export`,
      );
    },
  );

  await report.check(
    {
      id: "6b",
      spike: 6,
      title: "a request through the alias reaches the 1140 s file",
    },
    async () => {
      const res = await ctx.req("/api/v3/scan/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const v = verify();
      v.expect(res.status === 200, `status ${res.status}`);
      v.expect(
        res.headers["x-spike-handler"] === "v4-scan-verify",
        `answered by ${res.headers["x-spike-handler"]}`,
      );
      return v.result(
        "reachable. Next's server does not enforce maxDuration at runtime; it is read from the build manifest by whatever hosts the build",
      );
    },
  );
}
