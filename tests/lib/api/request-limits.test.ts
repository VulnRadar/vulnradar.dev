import { describe, expect, it, vi } from "vitest";

import {
  MAX_REQUEST_BODY_BYTES,
  readBodyBounded,
} from "@/lib/api/request-limits";

function chunked(chunks: Uint8Array[], onCancel?: () => void): Request {
  let index = 0;
  return new Request("https://x.test/a", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
      cancel: onCancel,
    }),
    duplex: "half",
  } as RequestInit);
}

const encode = (text: string) => new TextEncoder().encode(text);

describe("readBodyBounded", () => {
  it("reads a body with no stream as empty text", async () => {
    expect(await readBodyBounded({ body: null })).toEqual({
      ok: true,
      text: "",
    });
  });

  it("joins chunks in order", async () => {
    const result = await readBodyBounded(
      chunked([encode('{"a"'), encode(":1}")]),
    );
    expect(result).toEqual({ ok: true, text: '{"a":1}' });
  });

  it("decodes a multi-byte character split across two chunks", async () => {
    const bytes = encode("café");
    const result = await readBodyBounded(
      chunked([bytes.slice(0, 4), bytes.slice(4)]),
    );
    expect(result).toEqual({ ok: true, text: "café" });
  });

  it("strips a leading BOM, as request.json() does", async () => {
    const result = await readBodyBounded(chunked([encode("﻿{}")]));
    expect(result).toEqual({ ok: true, text: "{}" });
  });

  it("accepts exactly the cap", async () => {
    const result = await readBodyBounded(chunked([new Uint8Array(10)]), 10);
    expect(result.ok).toBe(true);
  });

  it("refuses one byte over the cap", async () => {
    const result = await readBodyBounded(chunked([new Uint8Array(11)]), 10);
    expect(result).toEqual({ ok: false });
  });

  it("defaults to the request cap", async () => {
    const result = await readBodyBounded(
      chunked([new Uint8Array(MAX_REQUEST_BODY_BYTES + 1)]),
    );
    expect(result.ok).toBe(false);
  });

  it("stops reading and cancels the stream once it is over", async () => {
    const onCancel = vi.fn();
    let pulls = 0;
    const request = new Request("https://x.test/a", {
      method: "POST",
      body: new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            controller.enqueue(new Uint8Array(6));
          },
          cancel: onCancel,
        },
        { highWaterMark: 0 },
      ),
      duplex: "half",
    } as RequestInit);

    const result = await readBodyBounded(request, 10);

    expect(result.ok).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
    // An endless body is read only as far as the second chunk.
    expect(pulls).toBeLessThanOrEqual(3);
  });

  it("rejects when the stream fails midway", async () => {
    const request = new Request("https://x.test/a", {
      method: "POST",
      body: new ReadableStream({
        pull(controller) {
          controller.error(new Error("socket reset"));
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readBodyBounded(request)).rejects.toThrow("socket reset");
  });
});
