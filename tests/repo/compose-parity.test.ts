import { describe, expect, it } from "vitest";
import { localPlainHttpApplies } from "@/lib/server/http-front.mjs";
import { blocksNamed, readCompose } from "./_compose";

/**
 * docker-compose.dev.yml builds the image the published one is built from, so
 * a build arg missing from it is a value that never reaches the browser bundle
 * and a dev stack that cannot do what the production one does. Turnstile was
 * the case that got reported: no build arg, so no site key, whatever .env said.
 */

const prod = readCompose("docker-compose.yml");
const dev = readCompose("docker-compose.dev.yml");

const keys = (yaml: string, name: string) =>
  blocksNamed(yaml, name)
    .flat()
    .map((entry) => entry.key)
    .sort();

describe("docker-compose.dev.yml mirrors docker-compose.yml", () => {
  it("passes the same build args", () => {
    expect(keys(prod, "args").length).toBeGreaterThan(0);
    expect(keys(dev, "args")).toEqual(keys(prod, "args"));
  });

  it("forwards .env without requiring it", () => {
    for (const yaml of [prod, dev]) {
      expect(yaml).toMatch(/env_file:\n\s+- path: \.env\n\s+required: false/);
    }
  });

  it("gives the app the same shutdown budget", () => {
    for (const yaml of [prod, dev]) {
      expect(yaml).toMatch(/^ {4}stop_grace_period: 40s$/m);
    }
  });

  it("tells the app how its port is bound", () => {
    // server.mjs and the boot warning read it. Compose only interpolates
    // HOST_BIND into `ports:` otherwise, so the container never sees it.
    for (const yaml of [prod, dev]) {
      expect(yaml).toMatch(/^ {6}HOST_BIND: \$\{HOST_BIND:-127\.0\.0\.1\}$/m);
    }
  });

  it("opens over plain HTTP on the steps the README gives", () => {
    // cp .env.example .env, set the two required values, compose up. A
    // placeholder https URL there left the loopback quick start 301ing every
    // browser to an https://localhost nothing listens on.
    const fromExample = Object.fromEntries(
      Array.from(
        readCompose(".env.example").matchAll(/^([A-Z_]+)=(.*)$/gm),
        (match) => [match[1], match[2]],
      ),
    );
    expect(
      localPlainHttpApplies({ ...fromExample, HOST_BIND: "127.0.0.1" }),
    ).toBe(true);
  });

  it("does not send anyone to a step that is not needed", () => {
    // The schema creates itself on first boot.
    expect(dev).not.toMatch(/npm run db:create/);
  });
});
