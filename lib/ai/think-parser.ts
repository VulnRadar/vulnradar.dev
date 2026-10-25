/**
 * The answer in a stored assistant message, without any reasoning.
 *
 * The chat route strips reasoning before a reply leaves the server, so a new
 * message never contains any. Conversations saved before that did: models that
 * reason inline wrote it as <think>...</think>, the old Anthropic adapter
 * synthesized the same tags, and the widget kept it all in the browser's saved
 * conversation and in the admin transcripts. This is how those are read now:
 * closed blocks are removed wherever they sit, and an unclosed one (a reply
 * cut off mid-thought) takes everything after it, because what follows an
 * unclosed tag was never the answer.
 */
export function visibleText(raw: string): string {
  const closed = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = closed.search(/<think>/i);
  return (open === -1 ? closed : closed.slice(0, open)).trim();
}
