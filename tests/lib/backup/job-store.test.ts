import { describe, it, expect, beforeEach } from "vitest";
import {
  createJob,
  getJob,
  getLatestJob,
  appendLog,
  finishJob,
  getActiveJobId,
  __resetForTests,
} from "@/lib/backup/job-store";

describe("backup job-store", () => {
  // activeJobId/jobs are module-level state, not reset between test files
  // by vitest -- several tests here never call finishJob (that's the
  // point, they're testing an in-progress job's shape), so without this
  // the next test's createJob would see a still-active job left behind
  // by the previous one and, correctly per the single-flight guarantee,
  // get null instead of a fresh job.
  beforeEach(() => {
    __resetForTests();
  });

  function newJob(userId = 1) {
    const job = createJob(userId);
    if (!job) throw new Error("expected createJob to succeed");
    return job;
  }

  it("creates a job with running status and marks it active", () => {
    const job = newJob(7);
    expect(job.status).toBe("running");
    expect(job.startedByUserId).toBe(7);
    expect(job.finishedAt).toBeNull();
    expect(job.error).toBeNull();
    expect(getActiveJobId()).toBe(job.id);
    expect(getJob(job.id)).toEqual(job);
  });

  it("appends and trims log lines, splitting on newlines", () => {
    const job = newJob();
    appendLog(job.id, "line one\nline two");
    appendLog(job.id, "line three");
    expect(getJob(job.id)!.log).toEqual(["line one", "line two", "line three"]);
  });

  it("ignores appendLog for an unknown job id instead of throwing", () => {
    expect(() => appendLog("does-not-exist", "hello")).not.toThrow();
  });

  it("ignores finishJob for an unknown job id instead of throwing", () => {
    expect(() => finishJob("does-not-exist", "success")).not.toThrow();
  });

  it("finishing a job clears the active job id and sets finishedAt", () => {
    const job = newJob();
    expect(getActiveJobId()).toBe(job.id);
    finishJob(job.id, "success");
    const finished = getJob(job.id)!;
    expect(finished.status).toBe("success");
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.error).toBeNull();
    expect(getActiveJobId()).toBeNull();
  });

  it("finishing a job with failure records the error message", () => {
    const job = newJob();
    finishJob(job.id, "failed", "pg_dump exited with code 1");
    expect(getJob(job.id)!.status).toBe("failed");
    expect(getJob(job.id)!.error).toBe("pg_dump exited with code 1");
  });

  it("only one job is active at a time; createJob refuses (returns null) while one is active", () => {
    const first = newJob();
    expect(getActiveJobId()).toBe(first.id);
    const second = createJob(1);
    expect(second).toBeNull();
    expect(getActiveJobId()).toBe(first.id);
  });

  it("createJob succeeds again once the active job has finished", () => {
    const first = newJob();
    finishJob(first.id, "success");
    expect(getActiveJobId()).toBeNull();
    const second = createJob(1);
    expect(second).not.toBeNull();
    expect(getActiveJobId()).toBe(second!.id);
  });

  it("getLatestJob returns undefined when no job has ever run", () => {
    expect(getLatestJob()).toBeUndefined();
  });

  it("getLatestJob returns the most recently started job", () => {
    const first = newJob();
    finishJob(first.id, "success");
    const second = createJob(1)!;
    expect(getLatestJob()!.id).toBe(second.id);
  });

  it("getLatestJob reflects a still-running job as the latest", () => {
    const first = newJob();
    finishJob(first.id, "failed", "boom");
    expect(getLatestJob()!.id).toBe(first.id);
    expect(getLatestJob()!.status).toBe("failed");
  });
});
