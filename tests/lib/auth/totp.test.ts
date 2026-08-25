import { describe, it, expect, afterEach, vi } from "vitest";
import {
  generateSecret,
  generateTOTP,
  verifyTOTP,
  verifyTOTPWithCounter,
} from "@/lib/auth/totp";

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyTOTP / verifyTOTPWithCounter", () => {
  it("accepts the current code and reports its step counter", () => {
    const secret = generateSecret();
    const step = 1_000_000;
    const atMs = step * 30 * 1000; // wall-clock at the start of `step`
    vi.useFakeTimers();
    vi.setSystemTime(atMs);
    const code = generateTOTP(secret);
    const r = verifyTOTPWithCounter(secret, code);
    expect(r.valid).toBe(true);
    expect(r.counter).toBe(step);
    expect(verifyTOTP(secret, code)).toBe(true);
  });

  it("reports the code's OWN step, not the wall-clock step, across the window", () => {
    // This is the property the replay guard relies on: a code generated for
    // step N must report counter N whether it is presented at N-1, N, or N+1.
    // Keying the guard on the wall-clock step (instead of this matched step)
    // was the replay bug -- the same code could be used once per step.
    const secret = generateSecret();
    const step = 2_000_000;
    const codeMs = step * 30 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(codeMs);
    const code = generateTOTP(secret);

    for (const presentedStep of [step - 1, step, step + 1]) {
      vi.setSystemTime(presentedStep * 30 * 1000);
      const r = verifyTOTPWithCounter(secret, code);
      expect(r.valid).toBe(true);
      // Always the code's own step, regardless of when it is presented.
      expect(r.counter).toBe(step);
    }
  });

  it("rejects a code outside the +/- window", () => {
    const secret = generateSecret();
    const step = 3_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(step * 30 * 1000);
    const code = generateTOTP(secret);
    // Two steps away is beyond the default window of 1.
    vi.setSystemTime((step + 2) * 30 * 1000);
    const r = verifyTOTPWithCounter(secret, code);
    expect(r.valid).toBe(false);
    expect(r.counter).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    const secret = generateSecret();
    expect(verifyTOTPWithCounter(secret, "abc").valid).toBe(false);
    expect(verifyTOTPWithCounter(secret, "12345").valid).toBe(false);
    expect(verifyTOTP(secret, "1234567")).toBe(false);
  });
});
