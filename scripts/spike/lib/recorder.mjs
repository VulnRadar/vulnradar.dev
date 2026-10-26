import http from "node:http";

/**
 * The listener that stands in for a hostile host. It records two things on
 * purpose: HTTP requests (with their headers and body size, so the positive
 * control can show credentials travelling) and raw TCP connections, which
 * catches a connection that never got as far as sending a request line.
 *
 * It binds every interface because the image test reaches it from inside a
 * container through the host gateway.
 */
export async function startRecorder() {
  const requests = [];
  let connections = 0;

  const server = http.createServer(async (req, res) => {
    let bodyBytes = 0;
    for await (const chunk of req) bodyBytes += chunk.length;
    requests.push({
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      bodyBytes,
    });
    res.writeHead(200, {
      "content-type": "text/plain",
      "x-spike-recorder": "1",
    });
    res.end("recorded");
  });
  server.on("connection", () => {
    connections++;
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", resolve);
  });

  return {
    port: server.address().port,
    connections: () => connections,
    requests: () => [...requests],
    reset() {
      requests.length = 0;
      connections = 0;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
