// The real front server and the real shutdown sequence in a process of their
// own, so tests/server-shutdown.test.ts can send it a signal and read its exit
// code. Only the database is fake. Runs under bare node, which strips the types
// from the .ts import.
import { createFrontServer } from "../../server.mjs";
import { createGracefulShutdown } from "../../lib/database/boot/graceful-shutdown.ts";

const HOLD_MS = 600;
const SCAN_RUNS_ON_FOR_MS = 300;

const say = (line) => process.stdout.write(`${line}\n`);

let scansRunning = 0;

const server = createFrontServer(
  () => (req, res) => {
    say("held");
    scansRunning = 1;
    setTimeout(() => {
      res.end("finished");
      say("responded");
      setTimeout(() => {
        scansRunning = 0;
        say("scan-finished");
      }, SCAN_RUNS_ON_FOR_MS);
    }, HOLD_MS);
  },
  {},
);

const shutdown = createGracefulShutdown({
  appName: "fixture",
  stopWorkers: async () => say("workers-stopped"),
  countInFlightScans: async () => scansRunning,
  pool: {
    end: async () => say("pool-ended"),
  },
});

process.on("SIGTERM", () => void shutdown());
// Windows has no catchable SIGTERM: child.kill() there ends the process
// outright, so the test asks for the same event over IPC instead.
process.on("message", (signal) => process.emit(signal));

server.listen(0, "127.0.0.1", () => say(`listening ${server.address().port}`));
