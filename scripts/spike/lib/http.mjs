import http from "node:http";
import { performance } from "node:perf_hooks";

/**
 * A raw HTTP client on node:http, because the checks need things fetch hides
 * or forbids: an arbitrary Host header, a body on DELETE, chunked request
 * bodies, duplicate response header lines, and the arrival time of every
 * response chunk.
 */
export function rawRequest({
  port,
  host = "127.0.0.1",
  method = "GET",
  path,
  headers = {},
  body,
  chunked = false,
  timeoutMs = 60_000,
}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const outgoing = { ...headers };
    const payload =
      body === undefined || body === null
        ? null
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(body);
    if (payload) {
      if (chunked) outgoing["transfer-encoding"] = "chunked";
      else outgoing["content-length"] = String(payload.length);
    }

    const req = http.request(
      { host, port, method, path, headers: outgoing, agent: false },
      (res) => {
        const chunks = [];
        const parts = [];
        res.on("data", (chunk) => {
          chunks.push({ at: performance.now() - started, bytes: chunk.length });
          parts.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          const totalMs = performance.now() - started;
          resolve(buildResponse(res, Buffer.concat(parts), chunks, totalMs));
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timed out after ${timeoutMs} ms`));
    });
    req.on("error", reject);

    if (!payload) {
      req.end();
    } else if (chunked) {
      const step = 64 * 1024;
      for (let i = 0; i < payload.length; i += step) {
        req.write(payload.subarray(i, i + step));
      }
      req.end();
    } else {
      req.end(payload);
    }
  });
}

function buildResponse(res, body, chunks, totalMs) {
  const headers = {};
  for (const [name, value] of Object.entries(res.headers)) {
    headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  const rawHeaders = res.rawHeaders;
  return {
    status: res.statusCode,
    headers,
    rawHeaders,
    body,
    chunks,
    totalMs,
    firstByteMs: chunks.length ? chunks[0].at : totalMs,
    text: () => body.toString("utf8"),
    json: () => JSON.parse(body.toString("utf8")),
    /** How many header lines of this name the client received. */
    headerLines(name) {
      const lower = name.toLowerCase();
      let count = 0;
      for (let i = 0; i < rawHeaders.length; i += 2) {
        if (rawHeaders[i].toLowerCase() === lower) count++;
      }
      return count;
    },
  };
}

/** `rawRequest` that reports a transport failure instead of throwing. */
export async function tryRequest(options) {
  try {
    return { response: await rawRequest(options), error: null };
  } catch (error) {
    return { response: null, error };
  }
}

/**
 * Split a Link header into its link-values. Next folds several `Link` lines
 * into one comma separated value, so a client has to parse it, and so does
 * the harness: commas inside `<...>` or quotes do not separate values.
 */
export function parseLinkHeader(value) {
  if (!value) return [];
  const links = [];
  let inAngle = false;
  let inQuote = false;
  let start = 0;
  const pieces = [];
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"' && !inAngle) inQuote = !inQuote;
    else if (ch === "<" && !inQuote) inAngle = true;
    else if (ch === ">" && !inQuote) inAngle = false;
    else if (ch === "," && !inQuote && !inAngle) {
      pieces.push(value.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(value.slice(start));

  for (const piece of pieces) {
    const match = /^\s*<([^>]*)>\s*(.*)$/.exec(piece);
    if (!match) continue;
    const params = {};
    for (const param of match[2].split(";")) {
      const eq = param.indexOf("=");
      if (eq === -1) continue;
      const key = param.slice(0, eq).trim().toLowerCase();
      let val = param.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      params[key] = val;
    }
    links.push({ target: match[1], params });
  }
  return links;
}

/**
 * Whether a streamed response left the server progressively. A body held
 * back until the handler finishes arrives as one chunk (or a burst) at the
 * very end, so its first byte and last byte are almost the same instant.
 * `spreadMs` is measured from the first chunk, which makes it immune to a
 * slow first request (a dev compile) delaying the start.
 */
export function profileStream(response, { lines, gapMs }) {
  const chunks = response.chunks;
  if (!chunks.length) {
    return {
      chunkCount: 0,
      firstByteMs: response.totalMs,
      spreadMs: 0,
      unbuffered: false,
    };
  }
  const first = chunks[0].at;
  const last = chunks[chunks.length - 1].at;
  const spreadMs = last - first;
  const expectedSpread = (lines - 1) * gapMs;
  return {
    chunkCount: chunks.length,
    firstByteMs: Math.round(first),
    spreadMs: Math.round(spreadMs),
    unbuffered: chunks.length >= 4 && spreadMs >= expectedSpread * 0.6,
  };
}
