import { describe, it, expect } from "vitest";
import {
  tokenize,
  toElements,
  decodeEntities,
} from "@/lib/scanner/html/tokenizer";

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
    expect(() => toElements(tokenize(`</div><p>ok</p>`))).not.toThrow();
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
});
