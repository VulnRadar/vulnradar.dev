import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");

describe("the published image's libuv threadpool", () => {
  // libuv reads the variable once, at the first threadpool job, so it has to
  // be in the environment the server starts in: the final stage, not a build
  // stage whose ENV never reaches the running container.
  it("is sized in the final stage, the one the server runs in", () => {
    const finalStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
    expect(finalStage).toMatch(/^ENV UV_THREADPOOL_SIZE=16$/m);
  });
});
