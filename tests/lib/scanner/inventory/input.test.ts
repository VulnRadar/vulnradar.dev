import { describe, expect, it } from "vitest";
import {
  buildInventoryInput,
  MAX_ATTRIBUTES,
  MAX_BODY_CHARS,
  MAX_COMMENTS,
  MAX_COOKIES,
  MAX_METAS,
  MAX_TAGS,
  MAX_URLS,
  MAX_URL_CHARS,
} from "@/lib/scanner/inventory/input";

const URL_ = "https://example.test/login";

function build(body: string, headers: HeadersInit = {}, url = URL_) {
  return buildInventoryInput(new Headers(headers), body, url);
}

describe("buildInventoryInput headers and cookies", () => {
  it("lowercases header names and keeps every value", () => {
    const headers = new Headers();
    headers.append("X-Powered-By", "PHP/8.4.27");
    headers.append(
      "Link",
      '<https://example.test/wp-json/>; rel="https://api.w.org/"',
    );
    const input = buildInventoryInput(headers, "", URL_);
    expect(input.headers.get("x-powered-by")).toEqual(["PHP/8.4.27"]);
    expect(input.headers.get("link")?.[0]).toContain("api.w.org");
  });

  it("keeps Set-Cookie out of headers and reads each cookie on its own", () => {
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      "XSRF-TOKEN=abc%3D; expires=Sat, 31 Oct 2026 22:36:52 GMT; path=/",
    );
    headers.append(
      "Set-Cookie",
      "wslatl-llc-session=eyJpdiI6abc; path=/; httponly",
    );
    const input = buildInventoryInput(headers, "", URL_);
    expect(input.headers.has("set-cookie")).toBe(false);
    expect(input.cookies).toEqual([
      { name: "XSRF-TOKEN", value: "abc%3D" },
      { name: "wslatl-llc-session", value: "eyJpdiI6abc" },
    ]);
  });

  it("does not split a cookie on the comma inside its Expires date", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "a=1; Expires=Sat, 31 Oct 2026 22:36:52 GMT");
    headers.append("Set-Cookie", "b=2");
    const names = buildInventoryInput(headers, "", URL_).cookies.map(
      (c) => c.name,
    );
    expect(names).toEqual(["a", "b"]);
  });

  it("reads a cookie with no value", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "flag");
    expect(buildInventoryInput(headers, "", URL_).cookies).toEqual([
      { name: "flag", value: "" },
    ]);
  });

  it("caps the number of cookies", () => {
    const headers = new Headers();
    for (let i = 0; i < MAX_COOKIES + 20; i++)
      headers.append("Set-Cookie", `c${i}=v`);
    expect(buildInventoryInput(headers, "", URL_).cookies).toHaveLength(
      MAX_COOKIES,
    );
  });

  it("returns header and cookie signal for an empty body", () => {
    const input = build("", { server: "nginx/1.18.0" });
    expect(input.headers.get("server")).toEqual(["nginx/1.18.0"]);
    expect(input.assets).toEqual([]);
    expect(input.title).toBe("");
  });
});

describe("buildInventoryInput markup", () => {
  it("reads every generator meta, not only the first", () => {
    const input = build(
      '<meta name="generator" content="Elementor 3.1"><meta content="WordPress 6.4.2" name="generator"><meta property="og:title" content="Hi">',
    );
    expect(
      input.metas.filter((m) => m.name === "generator").map((m) => m.content),
    ).toEqual(["Elementor 3.1", "WordPress 6.4.2"]);
    expect(input.metas.some((m) => m.name === "og:title")).toBe(true);
  });

  it("lowercases the meta name", () => {
    expect(build('<meta name="Generator" content="X">').metas[0].name).toBe(
      "generator",
    );
  });

  it("collects script and link URLs of any origin", () => {
    const input = build(
      '<script src="/livewire-3f8a23f8/livewire.min.js?id=9"></script><link href="https://cdn.other.test/a.css" rel="stylesheet">',
    );
    expect(input.assets).toContain("/livewire-3f8a23f8/livewire.min.js?id=9");
    expect(input.assets).toContain("https://cdn.other.test/a.css");
  });

  it("keeps a/form/img URLs only when they are the page's own origin", () => {
    const input = build(
      [
        '<a href="/account.php">own</a>',
        '<a href="https://example.test/other.php">own absolute</a>',
        '<a href="https://phpmyadmin.net/index.php">marketing link</a>',
        '<form action="/post.php"></form>',
        '<img src="//elsewhere.test/pixel.php">',
      ].join(""),
    );
    expect(input.assets).toContain("/account.php");
    expect(input.assets).toContain("/other.php");
    expect(input.assets).toContain("/post.php");
    const hosts = input.assets.map(
      (a) => new URL(a, "https://example.test/").hostname,
    );
    expect(hosts).not.toContain("phpmyadmin.net");
    expect(hosts).not.toContain("elsewhere.test");
  });

  it("skips fragments, javascript: and data: URLs", () => {
    const input = build(
      '<a href="#top"></a><a href="javascript:void(0)"></a><script src="data:text/javascript,1"></script>',
    );
    expect(input.assets).toEqual([]);
  });

  it("resolves a relative URL against the page", () => {
    const input = buildInventoryInput(
      new Headers(),
      '<a href="../build/app.js">x</a>',
      "https://example.test/a/b/page",
    );
    expect(input.assets).toEqual(["/a/build/app.js"]);
  });

  it("still reads absolute URLs when the page URL is not valid", () => {
    const input = buildInventoryInput(
      new Headers(),
      '<script src="https://cdn.test/x.js"></script><script src="/rel.js"></script>',
      "not a url",
    );
    expect(input.assets).toEqual(["https://cdn.test/x.js"]);
  });

  it("reads attribute names, which is how wire:* and x-data are found", () => {
    const input = build(
      '<div wire:click="save" x-data="{}"><input type="hidden" name="_token" value="abc"></div>',
    );
    expect(input.attributes).toContainEqual({
      tag: "div",
      name: "wire:click",
      value: "save",
    });
    expect(input.attributes).toContainEqual({
      tag: "div",
      name: "x-data",
      value: "{}",
    });
    expect(input.attributes).toContainEqual({
      tag: "input",
      name: "name",
      value: "_token",
    });
  });

  it("leaves out the attributes every element has", () => {
    const input = build('<div class="a" style="b" id="app"></div>');
    expect(input.attributes.map((a) => a.name)).toEqual(["id"]);
  });

  it("reads the title and the comments", () => {
    const input = build(
      "<html><head><title> Sign in | phpMyAdmin 5.2.1 </title></head><!-- cPanel --><body><!-- two --></body>",
    );
    expect(input.title).toBe("Sign in | phpMyAdmin 5.2.1");
    expect(input.comments).toEqual(["<!-- cPanel -->", "<!-- two -->"]);
  });

  it("reads only the first title", () => {
    expect(build("<title>One</title><svg><title>Two</title></svg>").title).toBe(
      "One",
    );
  });

  it("is empty-handed rather than throwing on garbage", () => {
    expect(() =>
      build("<<<>>><a href=<script src='", { server: "x" }),
    ).not.toThrow();
  });
});

describe("buildInventoryInput caps", () => {
  it("caps the body", () => {
    expect(build("a".repeat(MAX_BODY_CHARS + 500)).body).toHaveLength(
      MAX_BODY_CHARS,
    );
  });

  it("caps the URLs", () => {
    const body = Array.from(
      { length: MAX_URLS + 100 },
      (_, i) => `<script src="/a${i}.js"></script>`,
    ).join("");
    expect(build(body).assets).toHaveLength(MAX_URLS);
  });

  it("caps the length of one URL", () => {
    const input = build(
      `<script src="https://cdn.test/${"a".repeat(1_500)}.js"></script>`,
    );
    expect(input.assets[0].length).toBeLessThanOrEqual(MAX_URL_CHARS);
  });

  it("caps the metas", () => {
    const body = Array.from(
      { length: MAX_METAS + 50 },
      (_, i) => `<meta name="m${i}" content="x">`,
    ).join("");
    expect(build(body).metas).toHaveLength(MAX_METAS);
  });

  it("caps the comments", () => {
    const body = "<!-- c -->".repeat(MAX_COMMENTS + 50);
    expect(build(body).comments).toHaveLength(MAX_COMMENTS);
  });

  it("caps the attribute records", () => {
    const body = Array.from(
      { length: MAX_ATTRIBUTES + 200 },
      (_, i) => `<div data-n="${i}"></div>`,
    ).join("");
    expect(build(body).attributes).toHaveLength(MAX_ATTRIBUTES);
  });

  it("stops reading tags past the tag cap", () => {
    const body =
      "<p></p>".repeat(MAX_TAGS) + '<script src="/late.js"></script>';
    expect(build(body).assets).not.toContain("/late.js");
  });
});
