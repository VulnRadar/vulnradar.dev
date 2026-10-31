import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { domainToken } from "@/lib/auth/domain-token";

const original = process.env.API_KEY_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);
});

afterEach(() => {
  if (original === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = original;
});

describe("domainToken", () => {
  const alpha = domainToken("test.alpha.v1", "alpha tokens");
  const beta = domainToken("test.beta.v1", "beta tokens");

  it("round-trips a payload", () => {
    expect(alpha.verify(alpha.sign({ id: 1, ts: 2 }))).toEqual({
      id: 1,
      ts: 2,
    });
  });

  it("keeps two domains apart even under the same key", () => {
    const token = alpha.sign({ id: 1 });
    expect(beta.verify(token)).toBeNull();
    expect(alpha.verify(token)).toEqual({ id: 1 });
  });

  it("returns null for missing, malformed and forged tokens", () => {
    expect(alpha.verify(undefined)).toBeNull();
    expect(alpha.verify(null)).toBeNull();
    expect(alpha.verify("")).toBeNull();
    expect(alpha.verify("no-dot")).toBeNull();
    expect(alpha.verify("e30.AAAA")).toBeNull();
  });

  it("returns null once the key changes", () => {
    const token = alpha.sign({ id: 1 });
    process.env.API_KEY_ENCRYPTION_KEY = "d".repeat(64);
    expect(alpha.verify(token)).toBeNull();
  });

  it("reads the key on use, so a late-configured key works", () => {
    delete process.env.API_KEY_ENCRYPTION_KEY;
    const late = domainToken("test.late.v1", "late tokens");
    process.env.API_KEY_ENCRYPTION_KEY = "e".repeat(64);
    expect(late.verify(late.sign({ ok: true }))).toEqual({ ok: true });
  });

  it.each([
    ["unset", undefined],
    ["too short", "c".repeat(63)],
    ["too long", "c".repeat(65)],
  ])("refuses to sign when the key is %s, naming the purpose", (_l, value) => {
    if (value === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
    else process.env.API_KEY_ENCRYPTION_KEY = value;
    expect(() => alpha.sign({ id: 1 })).toThrow(
      "API_KEY_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes) to sign alpha tokens.",
    );
  });
});
