/**
 * The process `npm start` and the image run: a node:http server around Next's
 * request handler, which `next start` gives no way to get in front of.
 *
 * It exists for two things. It is the only code that can see the real socket,
 * so it is where a forged X-Forwarded-For gets replaced (lib/server/http-front
 * .mjs). And it holds the http.Server, so the shutdown sequence in
 * lib/database/boot/graceful-shutdown.ts can stop accepting connections and
 * drain them before the database pool goes away.
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  HTTP_SERVER_SLOT,
  enforceForwardedFor,
  localPlainHttpApplies,
  trustedProxyCidr,
} from "./lib/server/http-front.mjs";

/**
 * `env` is read per request rather than once: Next loads .env during
 * prepare(), after this server is created, and a source install keeps
 * TRUSTED_PROXY_CIDR there.
 *
 * @param {() => import("node:http").RequestListener} getRequestHandler
 * @param {Record<string, string | undefined>} [env]
 * @returns {import("node:http").Server}
 */
export function createFrontServer(getRequestHandler, env = process.env) {
  const server = createServer(async (req, res) => {
    try {
      enforceForwardedFor(req, trustedProxyCidr(env));
      await getRequestHandler()(req, res);
    } catch (err) {
      // Not req.url: console.error is persisted to the admin error log, and
      // the URL is where reset tokens and OAuth codes travel.
      console.error("Failed to handle a request:", err);
      if (!res.headersSent) res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });
  globalThis[HTTP_SERVER_SLOT] = server;
  return server;
}

/**
 * Has to run before Next is imported, which is why that import is dynamic:
 * Next and React pick their production builds from NODE_ENV as they load,
 * `next start` sets it for itself, and the middleware sandbox copies the
 * environment it finds.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {void}
 */
export function prepareStartEnv(env) {
  env.NODE_ENV ||= "production";
  env.NEXT_MANUAL_SIG_HANDLE ||= "1";
  if (localPlainHttpApplies(env)) env.ALLOW_INSECURE_HTTP = "1";
}

async function main() {
  prepareStartEnv(process.env);

  // The flags `next start` took, so a start command that passes one keeps
  // working. PORT is read here, not after prepare(), for the same reason it
  // never worked from .env under `next start`: the port comes first.
  const { values } = parseArgs({
    options: {
      port: { type: "string", short: "p" },
      hostname: { type: "string", short: "H" },
    },
    strict: false,
  });
  const port = Number(values.port ?? process.env.PORT ?? 3000);
  const hostname =
    typeof values.hostname === "string" ? values.hostname : undefined;

  const { default: next } = await import("next");
  /** @type {import("node:http").RequestListener | undefined} */
  let handle;
  const server = createFrontServer(() => handle);
  const app = next({ dev: false, hostname, port, httpServer: server });
  // register() in instrumentation.ts runs inside prepare(), which is what the
  // listen below waits for.
  await app.prepare();
  handle = app.getRequestHandler();

  server.on("error", (err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
  // No hostname means every interface, the same as `next start` without -H.
  server.listen(port, hostname, () => {
    // `next start` publishes this for its redirect handling of server actions.
    process.env.__NEXT_PRIVATE_ORIGIN = `http://localhost:${port}`;
    // `next start` printed its own ready line; nothing else says this now.
    console.log(`Ready on port ${port}.`);
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
