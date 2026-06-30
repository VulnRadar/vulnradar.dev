export type Segment = { type: "text" | "think"; content: string };

export function parseSegments(raw: string): Segment[] {
  const trimmed = trimToLastClosedThink(raw);
  const segments: Segment[] = [];
  const re = /<think>([\s\S]*?)<\/think>/gi;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(trimmed)) !== null) {
    const before = trimmed.slice(last, match.index);
    if (/\S/.test(before)) segments.push({ type: "text", content: before });
    const thinking = match[1].trim();
    if (thinking) segments.push({ type: "think", content: thinking });
    last = match.index + match[0].length;
  }

  const after = trimmed.slice(last);
  if (/\S/.test(after)) segments.push({ type: "text", content: after });

  if (segments.length === 0 && /\S/.test(trimmed)) {
    return [{ type: "text", content: trimmed }];
  }
  return segments;
}

function trimToLastClosedThink(raw: string): string {
  const lastClose = raw.lastIndexOf("</think>");
  if (lastClose === -1) {
    const firstOpen = raw.indexOf("<think>");
    if (firstOpen === -1) return raw;
    return raw.slice(0, firstOpen);
  }
  const tail = raw.slice(lastClose + "</think>".length);
  const lastOpen = tail.lastIndexOf("<think>");
  if (lastOpen === -1) return raw;
  return raw.slice(0, lastClose + "</think>".length + lastOpen);
}
