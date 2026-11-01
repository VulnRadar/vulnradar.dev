/**
 * The one bounded reader every target-facing body in the scanner goes
 * through. The callers only see a string (or a string and a flag), so what is
 * asserted here is the contract they rely on: the cap is in bytes, the read
 * stops and cancels at it, a stall is cut off at the timeout, and the flag
 * says when `text` is only the head of the body.
 */

import { describe, it, expect } from "vitest";
import { readBoundedBody, safeReadBody } from "@/lib/scanner/read-bounded-body";

function streamOf(chunks: Uint8Array[], stallAfter = false) {
  const state = { pulls: 0, cancelled: false };
  let i = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (i < chunks.length) {
          state.pulls++;
          controller.enqueue(chunks[i++]);
          return;
        }
        if (stallAfter) return new Promise<void>(() => {});
        controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { state, response: new Response(stream) };
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe("readBoundedBody", () => {
  it("returns a body that fits whole and says it was not cut", async () => {
    const { response } = streamOf([bytes("hello "), bytes("world")]);
    expect(await readBoundedBody(response, 1024)).toEqual({
      text: "hello world",
      truncated: false,
    });
  });

  it("counts a body of exactly the cap as whole", async () => {
    const { response } = streamOf([bytes("abcd")]);
    expect(await readBoundedBody(response, 4)).toEqual({
      text: "abcd",
      truncated: false,
    });
  });

  it("stops at the cap in bytes, cancels the stream and flags the cut", async () => {
    const { state, response } = streamOf(
      [bytes("a".repeat(10)), bytes("b".repeat(10)), bytes("c".repeat(10))],
      true,
    );
    const result = await readBoundedBody(response, 15);
    expect(result).toEqual({
      text: "a".repeat(10) + "b".repeat(5),
      truncated: true,
    });
    expect(state.pulls).toBe(2);
    expect(state.cancelled).toBe(true);
  });

  it("keeps a multi-byte character that was split across the last two chunks", async () => {
    // "é" is two bytes in UTF-8; the decoder holds the first until it is
    // flushed at the end of the stream.
    const e = bytes("é");
    const { response } = streamOf([
      new Uint8Array([...bytes("caf"), e[0]]),
      new Uint8Array([e[1]]),
    ]);
    expect(await readBoundedBody(response, 1024)).toEqual({
      text: "café",
      truncated: false,
    });
  });

  it("gives up on a stalled body at the timeout and returns what arrived", async () => {
    const { state, response } = streamOf([bytes("partial")], true);
    const started = Date.now();
    const result = await readBoundedBody(response, 1024, 100);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toEqual({ text: "partial", truncated: true });
    expect(state.cancelled).toBe(true);
  });

  it("reads a response with no body as empty and whole", async () => {
    expect(
      await readBoundedBody(new Response(null, { status: 204 }), 1024),
    ).toEqual({ text: "", truncated: false });
  });
});

describe("safeReadBody", () => {
  it("is the text of readBoundedBody", async () => {
    const { response } = streamOf([bytes("x".repeat(20))]);
    expect(await safeReadBody(response, 8)).toBe("x".repeat(8));
  });
});
