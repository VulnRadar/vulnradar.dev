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
  /** A reply's position in the saved transcript (persistableMessages), fixed
   *  when it is sent, so a rating and the server's record of the reply both
   *  name the same message. */
  index?: number;
  /** The reader's thumbs up (1) or down (-1) on this reply. */
  rating?: 1 | -1;
  /** Set when the bubble holds a failure rather than a reply, so it can be
   *  rendered as one instead of passing for an answer. */
  failed?: boolean;
};

/**
 * What is saved as the conversation: everything said, failures included
 * (staff reading a transcript need to see them), but not the welcome line,
 * /help output or knowledge an older build pasted in. /help is dropped as soon
 * as the next message is sent, so keeping it would shift the position of every
 * reply after it and a rating would land on the wrong message.
 */
export function persistableMessages(
  messages: ChatMessage[],
): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((m) => m.id !== "welcome" && !m.contextCmd && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
}

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
