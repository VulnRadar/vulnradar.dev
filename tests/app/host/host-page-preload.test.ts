import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The host report starts two requests that used to wait for the JavaScript. The
 * layout names both in the HTML, and they have to be the URLs the page fetches.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const layout = read("app/host/[hostname]/layout.tsx");
const page = read("app/host/[hostname]/page.tsx");
const takedown = read("components/host/domain-takedown-line.tsx");

describe("/host/[hostname] preload", () => {
  it("is declared by a server component", () => {
    expect(layout).not.toMatch(/^\s*["']use client["']/m);
    expect(layout).toContain('from "react-dom"');
  });

  it("preloads both of the requests the page makes", () => {
    for (const call of ["API.HOST(hostname)", "API.HOST_TREND(hostname)"]) {
      expect(layout).toContain(call);
      expect(page).toContain(`fetch(${call})`);
    }
    expect(layout).toContain('as: "fetch"');
    expect(layout).toContain('crossOrigin: "anonymous"');
  });

  it("does not call a noindex page indexable", () => {
    expect(page).not.toContain("indexable");
  });

  it("tells a domain owner how to take the report down", () => {
    expect(page).toContain("<DomainTakedownLine />");
    expect(takedown).toContain('href="/docs/sharing#domain-owner-controls"');
    expect(takedown).toContain("Verify it to take this report down");
  });

  it("keeps server code out of the client modules it renders", () => {
    for (const file of [
      "app/host/[hostname]/page.tsx",
      "app/shared/[token]/page.tsx",
      "components/host/domain-takedown-line.tsx",
    ]) {
      const imports = [...read(file).matchAll(/from "([^"]+)"/g)].map(
        (m) => m[1],
      );
      expect(imports.filter((i) => i === "@/lib/config/constants")).toEqual([]);
      expect(
        imports.filter((i) => /^node:|lib\/database|next\/headers/.test(i)),
      ).toEqual([]);
    }
  });
});
