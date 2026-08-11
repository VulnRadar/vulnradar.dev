import { describe, it, expect, beforeEach } from "vitest";
import {
  createJob,
  getJob,
  appendLog,
  setStatus,
  setStep,
  setCosignResult,
  finishJob,
  getActiveJobId,
  __resetForTests,
} from "@/lib/updater/job-store";

describe("updater job-store", () => {
  // activeJobId/jobs are module-level state, not reset between test files
  // by vitest -- most tests below never call finishJob (that's the point,
  // several are testing an in-progress job's shape), so without this the
  // next test's createJob would see a still-active job left behind by the
  // previous one and, correctly per the new atomic-refusal behavior, get
  // null instead of a fresh job.
  beforeEach(() => {
    __resetForTests();
  });

  /** createJob returns null only when a job is already active; every
   *  test here starts from __resetForTests(), so a fresh create always
   *  succeeds except in the two tests that specifically exercise the
   *  refusal path. */
  function newJob(version: string) {
    const job = createJob(version, 1);
    if (!job) throw new Error("expected createJob to succeed");
    return job;
  }

  it("creates a job with pending status and marks it active", () => {
    const job = newJob("3.1.0");
    expect(job.status).toBe("pending");
    expect(job.targetVersion).toBe("3.1.0");
    expect(job.startedByUserId).toBe(1);
    expect(getActiveJobId()).toBe(job.id);
    expect(getJob(job.id)).toEqual(job);
  });

  it("appends and trims log lines, splitting on newlines", () => {
    const job = newJob("3.1.0");
    appendLog(job.id, "line one\nline two");
    appendLog(job.id, "line three");
    const updated = getJob(job.id)!;
    expect(updated.log).toEqual(["line one", "line two", "line three"]);
  });

  it("ignores appendLog for an unknown job id instead of throwing", () => {
    expect(() => appendLog("does-not-exist", "hello")).not.toThrow();
  });

  it("updates status via setStatus", () => {
    const job = newJob("3.1.0");
    setStatus(job.id, "downloading");
    expect(getJob(job.id)!.status).toBe("downloading");
  });

  it("upserts steps: first call adds, second call with same name updates in place", () => {
    const job = newJob("3.1.0");
    setStep(job.id, "checksum", "running");
    expect(getJob(job.id)!.steps).toHaveLength(1);
    expect(getJob(job.id)!.steps[0]).toMatchObject({
      name: "checksum",
      status: "running",
    });

    setStep(job.id, "checksum", "done", "sha256:abc");
    const steps = getJob(job.id)!.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      name: "checksum",
      status: "done",
      detail: "sha256:abc",
    });
  });

  it("records the cosign verification outcome", () => {
    const job = newJob("3.1.0");
    setCosignResult(job.id, "verified");
    expect(getJob(job.id)!.cosignVerified).toBe("verified");
  });

  it("finishing a job clears the active job id and sets finishedAt", () => {
    const job = newJob("3.1.0");
    expect(getActiveJobId()).toBe(job.id);
    finishJob(job.id, "completed");
    const finished = getJob(job.id)!;
    expect(finished.status).toBe("completed");
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.error).toBeNull();
    expect(getActiveJobId()).toBeNull();
  });

  it("finishing a job with failure records the error message", () => {
    const job = newJob("3.1.0");
    finishJob(job.id, "failed", "checksum mismatch");
    expect(getJob(job.id)!.status).toBe("failed");
    expect(getJob(job.id)!.error).toBe("checksum mismatch");
  });

  it("only one job is active at a time; createJob refuses (returns null) while one is active", () => {
    const first = newJob("3.1.0");
    expect(getActiveJobId()).toBe(first.id);
    // This is the actual race-condition fix: a second createJob call while
    // one is active must be refused atomically, not silently overwrite the
    // active job id -- two concurrent POST /apply requests must never both
    // get past this and both call runUpdateJob against the same app
    // directory.
    const second = createJob("3.2.0", 1);
    expect(second).toBeNull();
    expect(getActiveJobId()).toBe(first.id);
    expect(getJob(first.id)!.id).toBe(first.id);
  });

  it("createJob succeeds again once the active job has finished", () => {
    const first = newJob("3.1.0");
    finishJob(first.id, "completed");
    expect(getActiveJobId()).toBeNull();
    const second = createJob("3.2.0", 1);
    expect(second).not.toBeNull();
    expect(getActiveJobId()).toBe(second!.id);
  });
});
