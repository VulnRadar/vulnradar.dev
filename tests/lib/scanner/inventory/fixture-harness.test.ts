import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Fingerprint } from "@/lib/scanner/inventory/types";
import {
  checkFixture,
  FIXTURE_ROOT,
  listFixtures,
  loadFixture,
  parseHeadersFile,
  runModuleFixtures,
  type FixtureExpect,
} from "./_fixture-harness";

const TABLE: Fingerprint[] = [
  {
    name: "Laravel",
    category: "framework",
    implies: [{ name: "PHP", category: "language" }],
    rules: [
      {
        in: "cookie",
        name: /[-_]session$/,
        valueMatch: /^eyJpdiI6/,
        weight: 95,
        provenance: "fixture",
      },
    ],
  },
  {
    name: "nginx",
    category: "server",
    rules: [
      {
        in: "header",
        name: "server",
        match: /^nginx(?:\/([\d.]+))?/i,
        version: { group: 1 },
        weight: 99,
        provenance: "fixture",
      },
    ],
  },
];

const HEADERS = [
  "HTTP/1.1 301 Moved Permanently",
  "Server: not-this-one",
  "Location: /login",
  "",
  "HTTP/2 200",
  "Server: nginx/1.18.0",
  "Set-Cookie: app-session=eyJpdiI6abc; path=/",
  "Set-Cookie: other=1; Expires=Sat, 31 Oct 2026 22:36:52 GMT",
  "",
].join("\r\n");

describe("parseHeadersFile", () => {
  it("reads only the final hop and keeps every Set-Cookie", () => {
    const headers = parseHeadersFile(HEADERS);
    expect(headers.get("server")).toBe("nginx/1.18.0");
    expect(headers.get("location")).toBeNull();
    expect(headers.getSetCookie()).toEqual([
      "app-session=eyJpdiI6abc; path=/",
      "other=1; Expires=Sat, 31 Oct 2026 22:36:52 GMT",
    ]);
  });

  it("skips a line that is not a header", () => {
    const headers = parseHeadersFile(
      "HTTP/1.1 200 OK\nnot a header\nbad name: x\nX-Ok: 1\n",
    );
    expect(headers.get("x-ok")).toBe("1");
  });

  it("returns empty headers for text with no response", () => {
    expect([...parseHeadersFile("nothing").keys()]).toEqual([]);
  });
});

describe("fixtures on disk", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "inventory-harness-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function write(
    slug: string,
    expectJson: Partial<FixtureExpect>,
    headers = HEADERS,
    body = "<p>hi</p>",
  ) {
    const dir = path.join(root, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "headers.txt"), headers);
    writeFileSync(path.join(dir, "body.html"), body);
    writeFileSync(
      path.join(dir, "expect.json"),
      JSON.stringify({
        kind: "synthetic",
        capturedAt: "2026-10-31",
        url: "https://example.test/login",
        must: [],
        ...expectJson,
      }),
    );
  }

  it("lists fixture directories sorted and tolerates a missing root", () => {
    write("b-two", {});
    write("a-one", {});
    writeFileSync(path.join(root, "README.md"), "x");
    expect(listFixtures(root)).toEqual(["a-one", "b-two"]);
    expect(listFixtures(path.join(root, "missing"))).toEqual([]);
  });

  it("points at the repository's fixture directory", () => {
    expect(FIXTURE_ROOT.replace(/\\/g, "/")).toMatch(
      /tests\/fixtures\/inventory$/,
    );
  });

  it("loads headers, body and expectation", () => {
    write("one", { must: [{ name: "nginx" }] });
    const fixture = loadFixture("one", root);
    expect(fixture.slug).toBe("one");
    expect(fixture.body).toBe("<p>hi</p>");
    expect(fixture.headers.get("server")).toBe("nginx/1.18.0");
    expect(fixture.expect.must).toEqual([{ name: "nginx" }]);
  });

  it("passes a fixture whose expectations hold", () => {
    write("ok", {
      must: [
        { name: "Laravel", minConfidence: 95 },
        { name: "PHP", minConfidence: 90 },
        { name: "nginx", version: "1.18.0", versionKind: "exact" },
      ],
      mustNot: ["WordPress"],
    });
    expect(checkFixture(loadFixture("ok", root), TABLE)).toEqual([]);
  });

  it("reports each way an expectation can fail", () => {
    write("bad", {
      must: [
        { name: "Laravel", minConfidence: 99 },
        { name: "Drupal" },
        { name: "nginx", version: "9.9.9", versionKind: "major" },
      ],
      mustNot: ["nginx"],
    });
    const text = checkFixture(loadFixture("bad", root), TABLE).join("\n");
    expect(text).toContain("Laravel confidence 95 is below 99");
    expect(text).toContain("expected Drupal, found nothing");
    expect(text).toContain("nginx version 1.18.0, expected 9.9.9");
    expect(text).toContain("nginx version kind exact, expected major");
    expect(text).toContain("nginx must not be detected");
  });

  it("judges a module only on its own names", () => {
    write("mixed", {
      must: [{ name: "Laravel" }, { name: "Drupal" }],
      mustNot: ["nginx"],
    });
    const fixture = loadFixture("mixed", root);
    expect(checkFixture(fixture, TABLE, ["Laravel"])).toEqual([]);
    expect(checkFixture(fixture, TABLE, ["Drupal"])).toEqual([
      "mixed: expected Drupal, found nothing",
    ]);
  });
});

// runModuleFixtures registers its tests while the file is collected, so the
// fixtures it reads have to exist before this line runs.
const registeredRoot = mkdtempSync(
  path.join(tmpdir(), "inventory-harness-reg-"),
);
for (const [slug, must] of [
  ["laravel-session", [{ name: "Laravel", minConfidence: 95 }]],
  ["unrelated-module", [{ name: "Drupal" }]],
] as const) {
  const dir = path.join(registeredRoot, slug);
  mkdirSync(dir);
  writeFileSync(path.join(dir, "headers.txt"), HEADERS);
  writeFileSync(path.join(dir, "body.html"), "<p>hi</p>");
  writeFileSync(
    path.join(dir, "expect.json"),
    JSON.stringify({
      kind: "synthetic",
      capturedAt: "2026-10-31",
      url: "https://example.test/",
      must,
    }),
  );
}
afterAll(() => rmSync(registeredRoot, { recursive: true, force: true }));

// One test for the Laravel fixture; the Drupal fixture belongs to another
// module and registers nothing here.
runModuleFixtures(TABLE, ["Laravel", "nginx"], registeredRoot);
