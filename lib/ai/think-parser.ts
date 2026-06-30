export type Segment = { type: "text" | "think"; content: string };

export function parseSegments(raw: string): Segment[] {
  const segments: Segment[] = [];
  const re = /<think>([\s\S]*?)<\/think>/gi;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(raw)) !== null) {
    const before = raw.slice(last, match.index);
    if (/\S/.test(before)) segments.push({ type: "text", content: before });
    const thinking = match[1].trim();
    if (thinking) segments.push({ type: "think", content: thinking });
    last = match.index + match[0].length;
  }

  const after = raw.slice(last);
  if (/\S/.test(after)) segments.push({ type: "text", content: after });

  if (segments.length === 0 && /\S/.test(raw)) {
    return [{ type: "text", content: raw }];
  }
  return segments;
}
