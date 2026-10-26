import { createHash } from "node:crypto";
import { headers as nextHeaders } from "next/headers";

export const HANDLER_HEADER = "x-spike-handler";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The bytes the binary route returns. The harness regenerates them from the
 * same formula, so a rewrite that mangled a binary body (a UTF-8 round trip
 * turns bytes above 0x7f into U+FFFD) changes the digest.
 */
export function binaryReport(size = 65536) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0xfe], 0);
  return bytes;
}

async function readBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const bytes = Buffer.from(await request.arrayBuffer());
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    contentType: request.headers.get("content-type"),
    transferEncoding: request.headers.get("transfer-encoding"),
    head: bytes.subarray(0, 64).toString("latin1"),
  };
}

/**
 * Everything a handler can observe about the request that reached it. Both
 * header views are captured because the design relies on both: route files
 * read `request.headers`, and the shared helpers read `headers()` from
 * `next/headers`.
 */
export async function snapshot(request, context, route) {
  const params = context?.params ? await context.params : {};
  const viaNextHeaders = await nextHeaders();
  return {
    route,
    method: request.method,
    params,
    url: request.url,
    nextUrl: {
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
      origin: request.nextUrl.origin,
    },
    searchParams: [...request.nextUrl.searchParams.entries()],
    requestHeaders: Object.fromEntries(request.headers),
    nextHeaders: Object.fromEntries(viaNextHeaders),
    session: request.cookies.get("session")?.value ?? null,
    body: await readBody(request),
  };
}

export function json(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export async function echo(request, context, route, init = {}) {
  const snap = await snapshot(request, context, route);
  const headers = new Headers(init.headers);
  headers.set(HANDLER_HEADER, route);
  return json(snap, { ...init, headers });
}

const encoder = new TextEncoder();

/**
 * A response whose chunks leave the handler `gapMs` apart. A layer that
 * buffers the body delivers the first byte only after the last chunk, which
 * is what the harness measures.
 */
export function slowStream({
  lines,
  gapMs,
  contentType,
  route,
  makeLine,
  extraHeaders,
}) {
  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < lines; i++) {
        controller.enqueue(encoder.encode(makeLine(i)));
        await new Promise((resolve) => setTimeout(resolve, gapMs));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      [HANDLER_HEADER]: route,
      ...extraHeaders,
    },
  });
}
