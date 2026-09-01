import { describe, it, expect } from "vitest";
import {
  extractStartPort,
  reapplyStartPort,
} from "@/lib/updater/preserve-start-port";

describe("extractStartPort", () => {
  it("extracts a port from a -p flag", () => {
    expect(extractStartPort("next start -p 8080")).toBe("8080");
  });

  it("extracts a port from a --port flag", () => {
    expect(extractStartPort("next start --port 8080")).toBe("8080");
  });

  it("extracts a port from a --port=N flag", () => {
    expect(extractStartPort("next start --port=8080")).toBe("8080");
  });

  it("returns null for a plain start script with no port flag", () => {
    expect(extractStartPort("next start")).toBeNull();
  });

  it("returns null for undefined/null/empty input", () => {
    expect(extractStartPort(undefined)).toBeNull();
    expect(extractStartPort(null)).toBeNull();
    expect(extractStartPort("")).toBeNull();
  });

  it("does not false-positive on an unrelated flag containing 'p'", () => {
    expect(extractStartPort("next start --experimental-https")).toBeNull();
  });
});

describe("reapplyStartPort", () => {
  it("reapplies the old custom port onto a new plain start script", () => {
    const result = reapplyStartPort("next start -p 8080", "next start");
    expect(result.preservedPort).toBe("8080");
    expect(result.script).toBe("next start -p 8080");
  });

  it("does nothing when the old script had no custom port", () => {
    const result = reapplyStartPort("next start", "next start");
    expect(result.preservedPort).toBeNull();
    expect(result.script).toBe("next start");
  });

  it("does nothing when there was no old script at all (fresh install)", () => {
    const result = reapplyStartPort(undefined, "next start");
    expect(result.preservedPort).toBeNull();
    expect(result.script).toBe("next start");
  });

  it("prefers the new release's own port over restoring the old one", () => {
    const result = reapplyStartPort("next start -p 8080", "next start -p 3000");
    expect(result.preservedPort).toBeNull();
    expect(result.script).toBe("next start -p 3000");
  });

  it("trims the new script before appending the preserved port", () => {
    const result = reapplyStartPort("next start -p 8080", "  next start  ");
    expect(result.script).toBe("next start -p 8080");
  });
});
