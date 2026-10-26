export function GET() {
  return new Response("ok", { headers: { "cache-control": "no-store" } });
}
