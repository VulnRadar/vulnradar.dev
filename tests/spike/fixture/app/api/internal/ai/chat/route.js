import { slowStream } from "../../../../../lib/echo.js";

const LINES = 8;
const GAP_MS = 300;

// Stands for the NDJSON stream of ai/chat: the request body is consumed first,
// the way the real handler reads the conversation, then lines leave one by one.
export async function POST(request) {
  const prompt = await request.text();
  return slowStream({
    lines: LINES,
    gapMs: GAP_MS,
    contentType: "application/x-ndjson; charset=utf-8",
    route: "internal-ai-chat",
    makeLine: (i) =>
      `${JSON.stringify({ i, at: Date.now(), promptBytes: prompt.length })}\n`,
  });
}
