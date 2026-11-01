import { describe, it, expect } from "vitest";
import {
  tokenize,
  toElements,
  decodeEntities,
  startTagAttributes,
} from "@/lib/scanner/html/tokenizer";

describe("startTagAttributes", () => {
  it("reads the attributes of one opening tag by the tokenizer's rules", () => {
    expect(
      startTagAttributes(`<input TYPE="hidden" name='csrf' value=a&#43;b>`),
    ).toEqual({ type: "hidden", name: "csrf", value: "a+b" });
  });

  it("matches names whole, so data-type is never type", () => {
    expect(startTagAttributes(`<input data-type="x">`)).toEqual({
      "data-type": "x",
    });
  });

  it("keeps the first of a duplicated attribute", () => {
    expect(startTagAttributes(`<a href="/one" href="/two">`)).toEqual({
      href: "/one",
    });
  });

  it("gives a valueless attribute the empty string and ignores a self-closing slash", () => {
    expect(startTagAttributes(`<input disabled name=q />`)).toEqual({
      disabled: "",
      name: "q",
    });
  });

  it("returns what it read of a tag that never closes", () => {
    expect(startTagAttributes(`<input name="q" value="open`)).toEqual({
      name: "q",
      value: "open",
    });
  });

  it("returns nothing for text with no tag in it", () => {
    expect(startTagAttributes("just text")).toEqual({});
    expect(startTagAttributes("<>")).toEqual({});
  });
});

describe("tokenize", () => {
  it("emits start, text, and end tokens for a simple element", () => {
    const tokens = tokenize("<p>hello</p>");
    expect(tokens.map((t) => t.kind)).toEqual(["start", "text", "end"]);
    expect(tokens[0]).toMatchObject({ kind: "start", tag: "p" });
    expect(tokens[1]).toMatchObject({ kind: "text", text: "hello" });
    expect(tokens[2]).toMatchObject({ kind: "end", tag: "p" });
  });

  it("parses attributes with double, single, and unquoted values", () => {
    const [start] = tokenize(`<a href="/x" data-y='z' disabled title=hi>`);
    if (start.kind !== "start") throw new Error("expected start token");
    expect(start.attrs).toEqual({
      href: "/x",
      "data-y": "z",
      disabled: "",
      title: "hi",
    });
  });

  it("does not let markup inside a script element close early", () => {
    const src = `<script>var x = "</div>";</script><div>real</div>`;
    const tokens = tokenize(src);
    const el = toElements(tokens).find((e) => e.tag === "div");
    expect(el).toBeDefined();
    expect(el!.text).toBe("real");
  });

  it("treats a script's raw text as one token even with nested-looking tags", () => {
    const src = `<script>if (a < 1) { console.log("<b>not html</b>"); }</script>`;
    const tokens = tokenize(src);
    const scriptEnd = tokens.findIndex(
      (t) => t.kind === "end" && t.tag === "script",
    );
    expect(scriptEnd).toBeGreaterThan(-1);
    // Only one script start/end pair: the "<b>" text did not get parsed as markup.
    const starts = tokens.filter((t) => t.kind === "start" && t.tag === "b");
    expect(starts.length).toBe(0);
  });

  it("recognises comments and does not tokenize their contents", () => {
    const tokens = tokenize(`<!-- <div>fake</div> --><p>real</p>`);
    const comment = tokens.find((t) => t.kind === "comment");
    expect(comment).toBeDefined();
    expect((comment as { text: string }).text).toContain("fake");
    const starts = tokens.filter((t) => t.kind === "start");
    expect(starts.map((s) => (s as { tag: string }).tag)).toEqual(["p"]);
  });

  it("recognises a doctype declaration", () => {
    const tokens = tokenize(`<!DOCTYPE html><html></html>`);
    expect(tokens[0].kind).toBe("doctype");
  });

  it("treats void elements as self-closing without an explicit slash", () => {
    const tokens = tokenize(`<img src="/x.png"><p>after</p>`);
    const img = tokens.find((t) => t.kind === "start" && t.tag === "img");
    expect(img).toMatchObject({ selfClosing: true });
  });

  it("does not throw on truncated or malformed markup", () => {
    expect(() => tokenize(`<div class="unterminated`)).not.toThrow();
    expect(() => tokenize(`<script>unterminated script`)).not.toThrow();
    expect(() => tokenize(`< notactuallyatag`)).not.toThrow();
    expect(() => tokenize(`</>`)).not.toThrow();
    expect(() => tokenize("")).not.toThrow();
  });

  it("keeps the first value when an attribute is duplicated", () => {
    const [start] = tokenize(`<input name="a" name="b">`);
    if (start.kind !== "start") throw new Error("expected start token");
    expect(start.attrs.name).toBe("a");
  });
});

describe("toElements", () => {
  it("tracks nesting depth and ancestors", () => {
    const els = toElements(tokenize(`<div><span><b>x</b></span></div>`));
    const b = els.find((e) => e.tag === "b")!;
    expect(b.depth).toBe(2);
    expect(b.ancestors).toEqual(["div", "span"]);
  });

  it("attributes text content to every open ancestor, not just the immediate parent", () => {
    const els = toElements(tokenize(`<form><label>Email</label></form>`));
    const form = els.find((e) => e.tag === "form")!;
    expect(form.text).toContain("Email");
  });

  it("recovers from mismatched end tags by unwinding to the nearest match", () => {
    // Invalid HTML (<b> closed before <i>), but must not throw or hang.
    const els = toElements(tokenize(`<p><b><i>x</b></i></p>`));
    expect(els.length).toBeGreaterThan(0);
  });

  it("does not create an element for an end tag with no matching start", () => {
    // `.not.toThrow()` was the whole assertion here, which is silent about
    // the thing the title claims: emitting an element for the stray </div>
    // would have passed, and every page check that counts or walks elements
    // would then see a phantom node.
    const els = toElements(tokenize(`</div><p>ok</p>`));
    expect(els.map((e) => e.tag)).toEqual(["p"]);
  });

  it("gives each element only the text it encloses, after mis-nesting and closing", () => {
    const els = toElements(
      tokenize(`<div>a<p>b<i>c</p>d</i>e</div><span>f</span>`),
    );
    const text = (tag: string) => els.find((e) => e.tag === tag)!.text;
    expect(text("div")).toBe("abcde");
    expect(text("p")).toBe("bc");
    expect(text("i")).toBe("c");
    expect(text("span")).toBe("f");
    expect(els.find((e) => e.tag === "span")!.ancestors).toEqual([]);
  });

  it("stops collecting text and ancestors past the depth cap", () => {
    const els = toElements(tokenize("<div>x".repeat(300)));
    expect(els[255].ancestors).toHaveLength(255);
    expect(els[255].text).toBe("x".repeat(45));
    expect(els[299].ancestors).toHaveLength(256);
    expect(els[299].depth).toBe(299);
    expect(els[299].text).toBe("");
  });

  it("keeps a full-size page of unclosed elements small and fast", () => {
    // Every element used to carry its own copy of up to 256 ancestor tags,
    // and every text token was appended to up to 256 open elements: about
    // 1.4 GB live and 6 s for a 1 MB page, which any scanned site could
    // send. Both are now read only for the elements that are asked.
    const body = "<code>x".repeat(Math.floor(1_000_000 / 7));
    const tokens = tokenize(body);
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const els = toElements(tokens);
    const ms = performance.now() - started;
    const grewMb = (process.memoryUsage().heapUsed - heapBefore) / 1e6;

    expect(els).toHaveLength(Math.floor(1_000_000 / 7));
    expect(grewMb).toBeLessThan(300);
    expect(ms).toBeLessThan(3000);
    expect(els[10].ancestors).toHaveLength(10);
    expect(els[10].text.length).toBe(128 * 1024);
  });
});

describe("decodeEntities", () => {
  it("decodes named entities used in real attribute values", () => {
    expect(decodeEntities("a &amp; b")).toBe("a & b");
    expect(decodeEntities("&lt;script&gt;")).toBe("<script>");
    expect(decodeEntities("&quot;quoted&quot;")).toBe('"quoted"');
  });

  it("decodes numeric and hex references", () => {
    expect(decodeEntities("&#104;ttp")).toBe("http");
    expect(decodeEntities("&#x68;ttp")).toBe("http");
  });

  it("leaves plain text without ampersands untouched", () => {
    expect(decodeEntities("no entities here")).toBe("no entities here");
  });

  it.each([
    // A browser leaves a name without its semicolon alone when a letter,
    // digit or = follows, so these query strings reach the server as written.
    ["/account?tab=1&gtm=GTM-ABC", "/account?tab=1&gtm=GTM-ABC"],
    ["/x?plan=2&quota=5", "/x?plan=2&quota=5"],
    ["/x?a=1&lt=2", "/x?a=1&lt=2"],
    ["/x?a=1&amp2", "/x?a=1&amp2"],
  ])("keeps %s as a browser would submit it", (value, submitted) => {
    expect(decodeEntities(value)).toBe(submitted);
  });

  it("decodes a name without its semicolon when nothing word-like follows", () => {
    expect(decodeEntities("a &amp b")).toBe("a & b");
    expect(decodeEntities("x &lt")).toBe("x <");
    expect(decodeEntities("&QUOT;up&QUOT;")).toBe('"up"');
  });

  it("never decodes &apos without its semicolon or a name in the wrong case", () => {
    expect(decodeEntities("it&apos s")).toBe("it&apos s");
    expect(decodeEntities("&Quot;x&Quot;")).toBe("&Quot;x&Quot;");
  });

  it("decodes once, so an escaped ampersand stays an ampersand", () => {
    expect(decodeEntities("&#38;lt;")).toBe("&lt;");
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeEntities("a&#43;b&#34;c")).toBe('a+b"c');
    expect(decodeEntities("http&#58//x")).toBe("http://x");
  });
});
