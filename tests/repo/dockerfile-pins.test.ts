import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readWorkflow, workflowSteps, stepNamed } from "./_workflow-steps";

/**
 * The published image: what it is built from, what it contains and what the
 * process inside it can change.
 *
 * A tag can be moved, so a build pinned only by tag is not reproducible from
 * the repository. Code owned by the uid the server runs as turns any write
 * primitive in the app into code execution that lasts as long as the
 * container. And the image cannot run a cosign binary at all, because the
 * updater that would call it is switched off there.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const dockerfile = read("Dockerfile");

/** Instructions with comments dropped and `\` continuations joined. */
const instructions = dockerfile
  .replace(/\\\n\s*/g, " ")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"));

const runnerStart = instructions.findIndex((l) => l.endsWith(" AS runner"));
const runner = instructions.slice(runnerStart);
const froms = instructions.filter((l) => l.startsWith("FROM "));

describe("the Dockerfile's base images", () => {
  it("has the builder and runner stages and no others", () => {
    expect(froms.map((l) => l.split(" AS ")[1])).toEqual(["builder", "runner"]);
  });

  it("pins every stage to a tag and a digest Dependabot can move together", () => {
    for (const line of froms) {
      expect(line).toMatch(
        /^FROM [^\s:@]+:[^\s@]+@sha256:[0-9a-f]{64} AS \w+$/,
      );
    }
  });

  it("builds and runs on the same image", () => {
    const image = (l: string) => l.split(" ")[1];
    expect(image(froms[0])).toBe(image(froms[1]));
  });

  it("is watched by Dependabot's docker ecosystem", () => {
    expect(read(".github/dependabot.yml")).toMatch(
      /package-ecosystem: "docker"\n\s+directories:\n\s+- "\/"/,
    );
  });
});

describe("the image ships no cosign", () => {
  it("has no cosign stage or copy", () => {
    for (const line of instructions) {
      expect(line).not.toMatch(/cosign/i);
    }
  });

  it("keeps the updater disabled, which is why nothing could run it", () => {
    expect(runner).toContain("ENV VULNRADAR_UPDATER_DISABLED=true");
  });
});

describe("the runner stage's code is not writable by the server", () => {
  const copies = runner.filter((l) => l.startsWith("COPY "));
  const chowns = runner.filter((l) => /\bchown\b/.test(l));

  it("copies every path root-owned", () => {
    expect(copies.length).toBeGreaterThanOrEqual(7);
    for (const line of copies) {
      expect(line).not.toMatch(/--chown/);
    }
  });

  it.each([
    "/app/.next ./.next",
    "/app/node_modules ./node_modules",
    "/app/package.json ./package.json",
    "/app/next.config.mjs ./next.config.mjs",
    "/app/server.mjs ./server.mjs",
    "/app/scripts ./scripts",
    "/app/lib ./lib",
  ])("copies %s from the builder", (paths) => {
    expect(copies).toContain(`COPY --from=builder ${paths}`);
  });

  it("makes only the cache, the backups and the data directory writable", () => {
    expect(chowns).toHaveLength(1);
    const targets = /chown -R nextjs:nodejs (.+)$/.exec(chowns[0])?.[1] ?? "";
    expect(targets.split(/\s+/).sort()).toEqual([
      "/app/.next/cache",
      "/app/backups",
      "/app/data",
    ]);
  });

  it("leaves the build's webpack cache behind", () => {
    // The chown below rewrites every file in .next/cache into a new layer, so
    // anything still in there at that point is stored in the image twice.
    const builder = instructions.slice(0, runnerStart);
    const clear = builder.indexOf("RUN rm -rf .next/cache");
    expect(clear).toBeGreaterThan(builder.indexOf("RUN npm run build"));
  });

  it("creates those directories before handing them over", () => {
    expect(chowns[0]).toMatch(/mkdir -p [^&]*\/app\/\.next\/cache/);
    expect(chowns[0]).toMatch(/mkdir -p [^&]*\/app\/backups/);
    expect(chowns[0]).toMatch(/mkdir -p [^&]*\/app\/data\/avatars/);
  });

  it("drops to the unprivileged user afterwards", () => {
    const user = runner.indexOf("USER nextjs");
    expect(user).toBeGreaterThan(runner.indexOf(chowns[0]));
    expect(runner.filter((l) => l.startsWith("USER "))).toEqual([
      "USER nextjs",
    ]);
  });

  it("starts through npm, so package.json decides what runs", () => {
    expect(runner).toContain('CMD ["npm", "start"]');
  });
});

describe("the Dockerfile's comments", () => {
  const comments = dockerfile
    .split("\n")
    .filter((l) => l.trim().startsWith("#"))
    .join("\n");

  it("does not claim vitest is a production dependency", () => {
    expect(comments).not.toMatch(/AUDIT-013#deps-02/);
    expect(comments).not.toMatch(/`vitest`/);
  });

  it("does not claim three install scripts", () => {
    expect(comments).not.toMatch(/only three lockfile entries/);
  });
});

describe("the published images do not bake in an origin", () => {
  it.each(["docker-publish.yml", "docker-publish-arm64.yml"])(
    "%s builds with NEXT_PUBLIC_APP_URL empty",
    (file) => {
      const workflow = readWorkflow(file);
      expect(workflow).toMatch(/^ {12}NEXT_PUBLIC_APP_URL=\s*$/m);
      expect(workflow).not.toMatch(/vars\.NEXT_PUBLIC_APP_URL/);
    },
  );

  it("keeps the arm64 tag check anchored at both ends", () => {
    const resolve = stepNamed(
      workflowSteps(readWorkflow("docker-publish-arm64.yml")),
      "Resolve tag",
    );
    expect(resolve.code).toContain(
      String.raw`TAG_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'`,
    );
  });
});

describe("the self-host job proves all of it against the real image", () => {
  const steps = workflowSteps(readWorkflow("ci.yml"));
  const all = steps.map((s) => s.code).join("\n");

  it("builds with a sentinel origin that must not reach server code", () => {
    expect(stepNamed(steps, "Build the production image").code).toContain(
      "--build-arg NEXT_PUBLIC_APP_URL=https://build.invalid",
    );
  });

  it("sets the origin at run time", () => {
    expect(
      stepNamed(steps, "Boot against an empty database and wait for health")
        .code,
    ).toContain("-e APP_URL=http://localhost:3000");
  });

  it("fails if the sentinel is inlined into the forgot-password route", () => {
    expect(all).toContain(
      "grep -rl build.invalid .next/server/app/api/v3/auth/forgot-password",
    );
  });

  it("asserts the code is read-only and the cache is not", () => {
    expect(all).toContain("test ! -w node_modules/next/package.json");
    expect(all).toContain("test -w .next/cache");
  });

  it("asserts the image has no cosign binary", () => {
    expect(all).toMatch(/command -v cosign/);
  });

  it("checks for the server npm start runs", () => {
    expect(
      stepNamed(
        steps,
        "Assert the runtime image carries what the docs tell operators to run",
      ).code,
    ).toContain("server.mjs");
  });

  describe("the documented compose quick start", () => {
    const quickstart = () =>
      stepNamed(steps, "Boot the documented compose quick start");

    it("starts from .env.example with both emails empty", () => {
      expect(quickstart().code).toContain("cp .env.example .env");
      expect(quickstart().code).toMatch(/CONTACT_EMAIL=/);
      expect(quickstart().code).toMatch(/SUPPORT_EMAIL=/);
    });

    it("sets only the two variables the quick start asks for", () => {
      const set = [...quickstart().code.matchAll(/s\/\^([A-Z_]+)=/g)].map(
        (m) => m[1],
      );
      expect(set.sort()).toEqual([
        "API_KEY_ENCRYPTION_KEY",
        "POSTGRES_PASSWORD",
      ]);
    });

    it("runs the image this job built, not a published one", () => {
      expect(quickstart().code).toMatch(/docker tag vulnradar:ci "\$\{?IMAGE/);
      expect(quickstart().code).toMatch(/docker compose up -d --no-build/);
    });

    it("waits for the health endpoint to answer 200", () => {
      expect(quickstart().code).toContain("/api/v3/health");
      expect(quickstart().code).toMatch(/= "200"/);
    });

    it("cleans up before the next step needs the port", () => {
      expect(quickstart().code).toMatch(/docker compose down -v/);
      expect(quickstart().code).toMatch(/\btrap\b/);
      const boot = stepNamed(
        steps,
        "Boot against an empty database and wait for health",
      );
      expect(quickstart().index).toBeLessThan(boot.index);
    });
  });
});
