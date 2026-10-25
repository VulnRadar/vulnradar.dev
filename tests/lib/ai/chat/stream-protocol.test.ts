import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));

import {
  createChatEventDecoder,
  encodeChatEvent,
  TOOL_ACTIVITY_LABELS,
} from "@/lib/ai/chat/stream-protocol";

const { TOOL_NAMES } = await import("@/lib/ai/chat/tools");

describe("chat stream protocol", () => {
  it("round-trips events split across arbitrary chunk boundaries", () => {
    const wire =
      encodeChatEvent({ type: "tool", name: "get_scan" }) +
      encodeChatEvent({ type: "text", text: "Hello\nworld" }) +
      encodeChatEvent({ type: "done" });
    const decoder = createChatEventDecoder();
    const out = [];
    for (let i = 0; i < wire.length; i += 7)
      out.push(...decoder.feed(wire.slice(i, i + 7)));
    out.push(...decoder.flush());
    expect(out).toEqual([
      { type: "tool", name: "get_scan" },
      { type: "text", text: "Hello\nworld" },
      { type: "done" },
    ]);
  });

  it("skips a line that is not an event instead of throwing", () => {
    const decoder = createChatEventDecoder();
    expect(decoder.feed('garbage\n{"type":"done"}\n')).toEqual([
      { type: "done" },
    ]);
  });

  it("has an activity label for every tool the server can call", () => {
    for (const name of TOOL_NAMES)
      expect(TOOL_ACTIVITY_LABELS[name]).toBeTruthy();
  });
});
