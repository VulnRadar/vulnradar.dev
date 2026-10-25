/**
 * What POST /api/v3/ai/chat streams back: one JSON object per line.
 *
 * It streamed plain text before, which had room for exactly one thing, the
 * answer. With tools the reader also needs to see that something is
 * happening while Vera looks a scan up, and an error that happens after the
 * first word has nowhere to go in a plain-text body except into the answer
 * itself. Reasoning is not an event: the route never sends it.
 *
 * Client-safe: imported by the chat widget and the route alike.
 */

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "error"; message: string }
  | { type: "done" };

export const CHAT_STREAM_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export function encodeChatEvent(event: ChatStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Incremental decoder. Feed it each decoded chunk as it arrives; it returns
 * the complete events in that chunk and holds a partial line for the next.
 */
export function createChatEventDecoder() {
  let buffer = "";
  function parse(line: string): ChatStreamEvent | null {
    if (!line.trim()) return null;
    try {
      const value = JSON.parse(line) as ChatStreamEvent;
      return value && typeof value.type === "string" ? value : null;
    } catch {
      return null;
    }
  }
  return {
    feed(chunk: string): ChatStreamEvent[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.map(parse).filter((e): e is ChatStreamEvent => e !== null);
    },
    flush(): ChatStreamEvent[] {
      const last = parse(buffer);
      buffer = "";
      return last ? [last] : [];
    },
  };
}

/** The line shown while a tool runs. Keyed by tool name; an unknown name
 *  (a newer server than the cached widget) falls back to the generic one. */
export const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  search_knowledge: "Searching the docs",
  get_check: "Reading the check",
  get_release_notes: "Reading the changelog",
  list_my_scans: "Looking through your scans",
  get_scan: "Opening the scan",
  get_my_account: "Checking your account",
  get_my_stats: "Counting your scans",
};

export const TOOL_ACTIVITY_FALLBACK = "Looking that up";
