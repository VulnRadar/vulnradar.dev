import { describe, it, expect } from "vitest";
import {
  buildAiMessages,
  type ChatMessage,
} from "@/components/ai-chat/chat-history";

const msg = (m: Partial<ChatMessage> & Pick<ChatMessage, "role" | "content">) =>
  ({ id: Math.random().toString(36).slice(2), ...m }) as ChatMessage;

describe("buildAiMessages", () => {
  it("sends what was typed and answered, in order", () => {
    expect(
      buildAiMessages([
        msg({ id: "welcome", role: "assistant", content: "Hi, I'm Vera." }),
        msg({ role: "user", content: "How do I fix HSTS?" }),
        msg({ role: "assistant", content: "Add the header." }),
      ]),
    ).toEqual([
      { role: "user", content: "How do I fix HSTS?" },
      { role: "assistant", content: "Add the header." },
    ]);
  });

  it("never sends an error bubble back as if Vera had said it", () => {
    const out = buildAiMessages([
      msg({ role: "user", content: "hi" }),
      msg({
        role: "assistant",
        content: "The AI provider is down.",
        failed: true,
      }),
    ]);
    expect(out).toEqual([{ role: "user", content: "hi" }]);
  });

  it("drops /help output and knowledge saved by older builds", () => {
    const out = buildAiMessages([
      msg({
        role: "assistant",
        content: "**Slash commands**",
        contextCmd: "help",
      }),
      msg({
        role: "user",
        content: '<context cmd="docs">\nhuge file\n</context>',
        contextCmd: "docs",
      }),
      msg({ role: "user", content: "question" }),
    ]);
    expect(out).toEqual([{ role: "user", content: "question" }]);
  });

  it("cuts reasoning out of an old saved reply", () => {
    const out = buildAiMessages([
      msg({ role: "user", content: "q" }),
      msg({ role: "assistant", content: "<think>private</think>Answer" }),
    ]);
    expect(out[1]).toEqual({ role: "assistant", content: "Answer" });
    expect(JSON.stringify(out)).not.toContain("private");
  });
});
