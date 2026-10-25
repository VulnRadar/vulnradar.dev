import { visibleText } from "@/lib/ai/think-parser";

/** One bubble in the chat widget, as it is kept in state and in storage. */
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** "help" on the command list /help renders, which is the widget's own
   *  output and never sent to the model. Conversations saved by older builds
   *  also carry other values here, on knowledge the widget used to paste in;
   *  those are hidden and never sent either. */
  contextCmd?: string;
  /** What Vera is looking up while the reply has no words yet. */
  activity?: string;
  /** Set when the bubble holds a failure rather than a reply, so it can be
   *  rendered as one instead of passing for an answer. */
  failed?: boolean;
};

/**
 * The exact array of messages sent to /api/v3/ai/chat: what the reader typed
 * and what Vera answered, nothing else.
 *
 * Slash commands run on the server now, so there is no loaded knowledge to
 * carry, and a saved block from an older build is dropped rather than re-sent.
 * A failed bubble holds an error string, not something Vera said, and sending
 * it back taught the model to apologise for outages. Reasoning in an old saved
 * reply is cut for the same reason it is never shown.
 */
export function buildAiMessages(
  history: ChatMessage[],
): { role: string; content: string }[] {
  return history
    .filter((m) => m.id !== "welcome" && !m.contextCmd && !m.failed)
    .map((m) => ({
      role: m.role,
      content: m.role === "assistant" ? visibleText(m.content) : m.content,
    }))
    .filter((m) => m.content.trim());
}
