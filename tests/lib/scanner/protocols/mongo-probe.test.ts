/**
 * Tests for probeMongoUnauthenticated: the MongoDB wire-protocol auth
 * probe. isMaster is always answered pre-auth by design (topology
 * discovery), so it can't tell us whether authentication is required —
 * listDatabases is the actual signal, since a secured server rejects it
 * with an "unauthorized" error while an insecure one answers directly.
 *
 * Mocks at the network boundary (node:net's Socket), same convention as
 * tests/lib/scanner/protocols/banner.test.ts. Server replies are built
 * with a small test-local BSON/OP_REPLY encoder mirroring the real
 * MongoDB legacy wire format, so this also exercises the module's own
 * BSON decoder against real wire bytes rather than a stub.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { FakeSocket } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class MiniEmitter {
    private listeners: Record<string, Listener[]> = {};
    on(event: string, fn: Listener) {
      (this.listeners[event] ??= []).push(fn);
      return this;
    }
    once(event: string, fn: Listener) {
      const wrapper: Listener = (...args) => {
        this.listeners[event] = (this.listeners[event] || []).filter(
          (l) => l !== wrapper,
        );
        fn(...args);
      };
      return this.on(event, wrapper);
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.listeners[event] || []) fn(...args);
      return true;
    }
  }

  class FakeSocket extends MiniEmitter {
    static instances: FakeSocket[] = [];
    destroyed = false;
    written: Buffer[] = [];
    timeoutMs: number | undefined;
    connectCall: { port: number; host: string; cb: () => void } | undefined;

    constructor() {
      super();
      FakeSocket.instances.push(this);
    }
    setTimeout(ms: number) {
      this.timeoutMs = ms;
    }
    connect(port: number, host: string, cb: () => void) {
      this.connectCall = { port, host, cb };
    }
    write(data: Buffer) {
      this.written.push(data);
    }
    destroy() {
      this.destroyed = true;
    }
  }

  return { FakeSocket };
});

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { ...actual, Socket: FakeSocket };
});

import { probeMongoUnauthenticated } from "@/lib/scanner/protocols/banner";

const PUBLIC_IP = "93.184.216.34";

// ── Minimal test-local BSON / OP_REPLY encoders, mirroring the real wire
// format closely enough to exercise the module's decoder against genuine
// bytes rather than a stub of its own output. ──────────────────────────

function bsonDouble(key: string, value: number): Buffer {
  const keyBuf = Buffer.from(key, "utf8");
  const buf = Buffer.alloc(1 + keyBuf.length + 1 + 8);
  let o = 0;
  buf.writeUInt8(0x01, o);
  o += 1;
  keyBuf.copy(buf, o);
  o += keyBuf.length;
  buf.writeUInt8(0, o);
  o += 1;
  buf.writeDoubleLE(value, o);
  return buf;
}

function bsonString(key: string, value: string): Buffer {
  const keyBuf = Buffer.from(key, "utf8");
  const valBuf = Buffer.from(value + "\0", "utf8");
  const buf = Buffer.alloc(1 + keyBuf.length + 1 + 4 + valBuf.length);
  let o = 0;
  buf.writeUInt8(0x02, o);
  o += 1;
  keyBuf.copy(buf, o);
  o += keyBuf.length;
  buf.writeUInt8(0, o);
  o += 1;
  buf.writeInt32LE(valBuf.length, o);
  o += 4;
  valBuf.copy(buf, o);
  return buf;
}

function bsonInt32(key: string, value: number): Buffer {
  const keyBuf = Buffer.from(key, "utf8");
  const buf = Buffer.alloc(1 + keyBuf.length + 1 + 4);
  let o = 0;
  buf.writeUInt8(0x10, o);
  o += 1;
  keyBuf.copy(buf, o);
  o += keyBuf.length;
  buf.writeUInt8(0, o);
  o += 1;
  buf.writeInt32LE(value, o);
  return buf;
}

function bsonDocument(elements: Buffer[]): Buffer {
  const bodyLen = elements.reduce((s, e) => s + e.length, 0);
  const totalLen = 4 + bodyLen + 1;
  const buf = Buffer.alloc(totalLen);
  buf.writeInt32LE(totalLen, 0);
  let o = 4;
  for (const e of elements) {
    e.copy(buf, o);
    o += e.length;
  }
  buf.writeUInt8(0, o);
  return buf;
}

function opReply(doc: Buffer): Buffer {
  const headerLen = 16 + 4 + 8 + 4 + 4; // std header + flags + cursorId + startingFrom + numberReturned
  const totalLen = headerLen + doc.length;
  const buf = Buffer.alloc(totalLen);
  let p = 0;
  buf.writeInt32LE(totalLen, p);
  p += 4; // messageLength
  buf.writeInt32LE(1, p);
  p += 4; // requestID
  buf.writeInt32LE(1, p);
  p += 4; // responseTo
  buf.writeInt32LE(1, p);
  p += 4; // opCode: OP_REPLY
  buf.writeInt32LE(0, p);
  p += 4; // responseFlags
  buf.writeBigInt64LE(BigInt(0), p);
  p += 8; // cursorID
  buf.writeInt32LE(0, p);
  p += 4; // startingFrom
  buf.writeInt32LE(1, p);
  p += 4; // numberReturned
  doc.copy(buf, p);
  return buf;
}

const isMasterOkReply = opReply(
  bsonDocument([bsonDouble("ok", 1), bsonInt32("maxWireVersion", 17)]),
);
const listDatabasesOkReply = opReply(bsonDocument([bsonDouble("ok", 1)]));
const listDatabasesDeniedReply = opReply(
  bsonDocument([
    bsonDouble("ok", 0),
    bsonString("errmsg", "not authorized on admin to execute command"),
    bsonInt32("code", 13),
  ]),
);

/** Poll until FakeSocket.instances has at least `count` entries. Avoids
 *  hard-coding an exact number of microtask ticks between the two
 *  sequential sendMongoCommand calls inside probeMongoUnauthenticated. */
async function waitForInstance(count: number): Promise<void> {
  while (FakeSocket.instances.length < count) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

beforeEach(() => {
  FakeSocket.instances.length = 0;
});

describe("probeMongoUnauthenticated", () => {
  it("sends a well-formed legacy OP_QUERY isMaster command first", async () => {
    const resultPromise = probeMongoUnauthenticated(PUBLIC_IP, 27017, 2000);
    await waitForInstance(1);
    const socket = FakeSocket.instances[0];
    socket.connectCall!.cb();

    const sent = socket.written[0];
    expect(sent.readInt32LE(12)).toBe(2004); // OP_QUERY opcode
    expect(sent.toString("utf8")).toContain("isMaster");
    expect(sent.toString("utf8")).toContain("admin.$cmd");

    socket.emit("data", isMasterOkReply);

    await waitForInstance(2);
    const socket2 = FakeSocket.instances[1];
    socket2.connectCall!.cb();
    socket2.emit("data", listDatabasesOkReply);

    await resultPromise;
  });

  it("sends listDatabases as the second command", async () => {
    const resultPromise = probeMongoUnauthenticated(PUBLIC_IP, 27017, 2000);
    await waitForInstance(1);
    FakeSocket.instances[0].connectCall!.cb();
    FakeSocket.instances[0].emit("data", isMasterOkReply);

    await waitForInstance(2);
    const socket2 = FakeSocket.instances[1];
    socket2.connectCall!.cb();
    expect(socket2.written[0].toString("utf8")).toContain("listDatabases");
    socket2.emit("data", listDatabasesOkReply);

    await resultPromise;
  });

  it("reports unauthenticatedAccess:true when listDatabases succeeds without credentials", async () => {
    const resultPromise = probeMongoUnauthenticated(PUBLIC_IP, 27017, 2000);
    await waitForInstance(1);
    FakeSocket.instances[0].connectCall!.cb();
    FakeSocket.instances[0].emit("data", isMasterOkReply);

    await waitForInstance(2);
    FakeSocket.instances[1].connectCall!.cb();
    FakeSocket.instances[1].emit("data", listDatabasesOkReply);

    const result = await resultPromise;
    expect(result?.reachable).toBe(true);
    expect(result?.unauthenticatedAccess).toBe(true);
    expect(result?.detail).toMatch(/succeeded without authentication/i);
    expect(result?.detail).toContain("maxWireVersion 17");
  });

  it("reports unauthenticatedAccess:false when listDatabases is rejected as unauthorized", async () => {
    const resultPromise = probeMongoUnauthenticated(PUBLIC_IP, 27017, 2000);
    await waitForInstance(1);
    FakeSocket.instances[0].connectCall!.cb();
    FakeSocket.instances[0].emit("data", isMasterOkReply);

    await waitForInstance(2);
    FakeSocket.instances[1].connectCall!.cb();
    FakeSocket.instances[1].emit("data", listDatabasesDeniedReply);

    const result = await resultPromise;
    expect(result?.unauthenticatedAccess).toBe(false);
    expect(result?.detail).toContain(
      "not authorized on admin to execute command",
    );
  });

  it("still reports the auth result even when isMaster itself times out", async () => {
    const resultPromise = probeMongoUnauthenticated(PUBLIC_IP, 27017, 100);
    await waitForInstance(1);
    FakeSocket.instances[0].connectCall!.cb();
    FakeSocket.instances[0].emit("timeout");

    await waitForInstance(2);
    FakeSocket.instances[1].connectCall!.cb();
    FakeSocket.instances[1].emit("data", listDatabasesOkReply);

    const result = await resultPromise;
    expect(result?.unauthenticatedAccess).toBe(true);
    expect(result?.detail).not.toContain("maxWireVersion");
  });

  it("returns unauthenticatedAccess:null when listDatabases never completes but isMaster did", async () => {
    const resultPromise = probeMongoUnauthenticated(PUBLIC_IP, 27017, 100);
    await waitForInstance(1);
    FakeSocket.instances[0].connectCall!.cb();
    FakeSocket.instances[0].emit("data", isMasterOkReply);

    await waitForInstance(2);
    FakeSocket.instances[1].connectCall!.cb();
    FakeSocket.instances[1].emit("timeout");

    const result = await resultPromise;
    expect(result?.reachable).toBe(true);
    expect(result?.unauthenticatedAccess).toBeNull();
  });

  it("returns null when neither command produces a reply at all", async () => {
    const resultPromise = probeMongoUnauthenticated(PUBLIC_IP, 27017, 100);
    await waitForInstance(1);
    FakeSocket.instances[0].connectCall!.cb();
    FakeSocket.instances[0].emit("error", new Error("ECONNREFUSED"));

    await waitForInstance(2);
    FakeSocket.instances[1].connectCall!.cb();
    FakeSocket.instances[1].emit("error", new Error("ECONNREFUSED"));

    const result = await resultPromise;
    expect(result).toBeNull();
  });

  it("refuses a private host without ever opening a socket", async () => {
    const result = await probeMongoUnauthenticated("192.168.1.1", 27017, 200);
    expect(result).toBeNull();
    expect(FakeSocket.instances.length).toBe(0);
  });

  it("refuses a port outside MongoDB's well-known list without opening a socket", async () => {
    const result = await probeMongoUnauthenticated(PUBLIC_IP, 80, 200);
    expect(result).toBeNull();
    expect(FakeSocket.instances.length).toBe(0);
  });
});
