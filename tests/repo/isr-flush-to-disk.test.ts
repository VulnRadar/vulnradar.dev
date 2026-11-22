import { describe, it, expect } from "vitest";
import { configSchema } from "next/dist/server/config-schema";
import { defaultConfig } from "next/dist/server/config-shared";
import nextConfig from "../../next.config.mjs";

/**
 * What Next renders at run time is never written to disk.
 *
 * Three routes take slugs outside generateStaticParams: app/checks/[id],
 * app/checks/category/[category] and app/alternatives/[competitor] all set
 * `dynamicParams = true`. With experimental.isrFlushToDisk at Next's default
 * of true, every response the incremental cache stores for such a slug is
 * written under .next/server and survives a restart, so anyone can fill the
 * disk by requesting made-up slugs. A pen test of another Next site did
 * exactly that, 404s included, at about 126 KB a request and without signing
 * in, and a Pterodactyl server that goes over its disk limit is stopped.
 *
 * The defence is one line in next.config.mjs. A later edit can drop it
 * without anything else noticing, and a Next upgrade can rename the key, in
 * which case Next prints a single warning at build time and ignores it. So
 * this checks the evaluated config, and that the installed Next still reads
 * the key and would otherwise default it to true.
 */
describe("next.config.mjs keeps runtime renders off the disk", () => {
  it("sets experimental.isrFlushToDisk to false", () => {
    expect(nextConfig.experimental?.isrFlushToDisk).toBe(false);
  });

  it("names a key the installed Next reads, and overrides its default", () => {
    expect(defaultConfig.experimental?.isrFlushToDisk).toBe(true);
    const parsed = configSchema.safeParse({
      experimental: nextConfig.experimental,
    });
    expect(
      parsed.success,
      parsed.success
        ? ""
        : `Next rejects the experimental block: ${JSON.stringify(parsed.error.issues)}`,
    ).toBe(true);
  });
});
