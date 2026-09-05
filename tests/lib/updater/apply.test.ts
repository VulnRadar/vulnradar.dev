/**
 * Tests for lib/updater/apply.ts, the self-update orchestrator.
 *
 * This is the most destructive privileged path in the product: it runs release
 * code on the host, DELETES files from the live install directory
 * (pruneExtraneous), and runs `npm ci` plus a migration against the production
 * database. The primitives around it are well covered (checksum, cosign,
 * copy-with-excludes, version-compare) but nothing covered the ORCHESTRATION:
 * that a bad checksum or a bad signature aborts BEFORE anything is copied, and
 * that the protect/strip lists pruneExtraneous is driven with are actually the
 * ones intended. Dropping "backups" or "uploads" from PROTECTED_PREFIXES in a
 * refactor would permanently delete a self-hoster's database backups or
 * uploaded avatars on their next update, and broke no test.
 *
 * Everything with a side effect is mocked at the module boundary: GitHub, the
 * filesystem, subprocess execution, and the copy/prune primitives. The real
 * job-store runs, so step/status transitions are asserted against real state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveRelease = vi.fn();
const mockDownloadReleaseAsset = vi.fn();
vi.mock("@/lib/updater/github-release", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/updater/github-release")>()),
  resolveRelease: (...a: unknown[]) => mockResolveRelease(...a),
  downloadReleaseAsset: (...a: unknown[]) => mockDownloadReleaseAsset(...a),
}));

const mockVerifyChecksum = vi.fn();
vi.mock("@/lib/updater/checksum", () => ({
  verifyChecksum: (...a: unknown[]) => mockVerifyChecksum(...a),
}));

const mockVerifyCosign = vi.fn();
vi.mock("@/lib/updater/cosign", () => ({
  verifyCosignSignature: (...a: unknown[]) => mockVerifyCosign(...a),
}));

const mockRunCommand = vi.fn();
const mockCommandAvailable = vi.fn();
vi.mock("@/lib/updater/exec", () => ({
  runCommand: (...a: unknown[]) => mockRunCommand(...a),
  commandAvailable: (...a: unknown[]) => mockCommandAvailable(...a),
}));

const mockCopyTreeOverlay = vi.fn();
const mockPruneExtraneous = vi.fn();
vi.mock("@/lib/updater/copy-with-excludes", () => ({
  copyTreeOverlay: (...a: unknown[]) => mockCopyTreeOverlay(...a),
  pruneExtraneous: (...a: unknown[]) => mockPruneExtraneous(...a),
}));

vi.mock("@/lib/config/runtime-config", () => ({
  getSettings: async () => ({ UPDATER_NPM_CI_TIMEOUT_MS: 60_000 }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    promises: {
      mkdtemp: vi.fn(async () => "/tmp/vulnradar-update-test"),
      writeFile: vi.fn(async () => undefined),
      mkdir: vi.fn(async () => undefined),
      readdir: vi.fn(async () => [
        { name: "vulnradar-v9.9.9", isDirectory: () => true },
      ]),
      readFile: vi.fn(async () =>
        JSON.stringify({ scripts: { start: "next start" } }),
      ),
      rm: vi.fn(async () => undefined),
    },
  };
});

const { runUpdateJob } = await import("@/lib/updater/apply");
const { createJob, getJob, __resetForTests } =
  await import("@/lib/updater/job-store");

function release() {
  return {
    tagName: "v9.9.9",
    assets: [
      { name: "vulnradar-v9.9.9.tar.gz", size: 123 },
      { name: "sha256sums.txt", size: 64 },
      { name: "vulnradar-v9.9.9.tar.gz.cert", size: 32 },
    ],
  };
}

/** The happy path, with every gate passing. Individual tests override one. */
function installHappyPath() {
  mockResolveRelease.mockResolvedValue(release());
  mockDownloadReleaseAsset.mockResolvedValue(Buffer.from("payload"));
  mockVerifyChecksum.mockReturnValue({ ok: true, actual: "abc123" });
  mockVerifyCosign.mockResolvedValue({ attempted: true, ok: true });
  mockCommandAvailable.mockResolvedValue(true);
  mockRunCommand.mockResolvedValue({ code: 0, timedOut: false });
  mockCopyTreeOverlay.mockResolvedValue({
    filesCopied: 10,
    dirsCreated: 2,
    skipped: [],
  });
  mockPruneExtraneous.mockResolvedValue({ filesDeleted: 1, dirsDeleted: 0 });
}

beforeEach(() => {
  __resetForTests();
  vi.clearAllMocks();
  installHappyPath();
});

describe("runUpdateJob: verification gates run before anything is written", () => {
  it("aborts on a checksum mismatch without copying or pruning a single file", async () => {
    mockVerifyChecksum.mockReturnValue({
      ok: false,
      error: "sha256 mismatch for vulnradar-v9.9.9.tar.gz",
    });
    const job = createJob("v9.9.9", 1)!;

    await runUpdateJob(job.id, "v9.9.9");

    expect(mockCopyTreeOverlay).not.toHaveBeenCalled();
    expect(mockPruneExtraneous).not.toHaveBeenCalled();
    expect(mockRunCommand).not.toHaveBeenCalled();
    const finished = getJob(job.id)!;
    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("sha256 mismatch");
  });

  it("aborts on a cosign signature mismatch without copying or pruning", async () => {
    mockVerifyCosign.mockResolvedValue({
      attempted: true,
      ok: false,
      error: "signature does not match",
    });
    const job = createJob("v9.9.9", 1)!;

    await runUpdateJob(job.id, "v9.9.9");

    expect(mockCopyTreeOverlay).not.toHaveBeenCalled();
    expect(mockPruneExtraneous).not.toHaveBeenCalled();
    const finished = getJob(job.id)!;
    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("signature");
  });

  it("continues when cosign itself is unavailable (soft gate), but records it as skipped", async () => {
    // A missing cosign binary must not block a self-hoster's update; a real
    // signature MISMATCH (above) still aborts.
    mockVerifyCosign.mockResolvedValue({
      attempted: false,
      error: "cosign not installed",
    });
    const job = createJob("v9.9.9", 1)!;

    await runUpdateJob(job.id, "v9.9.9");

    expect(mockCopyTreeOverlay).toHaveBeenCalled();
    expect(getJob(job.id)!.cosignVerified).toBe("skipped");
  });

  it("aborts when the release has no tarball asset", async () => {
    mockResolveRelease.mockResolvedValue({
      tagName: "v9.9.9",
      assets: [{ name: "sha256sums.txt", size: 64 }],
    });
    const job = createJob("v9.9.9", 1)!;

    await runUpdateJob(job.id, "v9.9.9");

    expect(mockDownloadReleaseAsset).not.toHaveBeenCalled();
    expect(getJob(job.id)!.status).toBe("failed");
  });

  it("aborts when no release matches the requested version", async () => {
    mockResolveRelease.mockResolvedValue(null);
    const job = createJob("v9.9.9", 1)!;

    await runUpdateJob(job.id, "v9.9.9");

    expect(getJob(job.id)!.status).toBe("failed");
    expect(getJob(job.id)!.error).toContain("v9.9.9");
  });
});

describe("runUpdateJob: the destructive prune is driven with the intended lists", () => {
  // These assertions pin the lists on purpose. pruneExtraneous DELETES from the
  // live install directory, so removing an entry here is a data-loss bug that
  // otherwise breaks nothing visible.
  const PROTECTED_NAMES = ["node_modules", ".git"];
  const PROTECTED_PREFIXES = [
    ".next",
    "data",
    "backups",
    ".npm",
    ".cache",
    "logs",
    "uploads",
  ];
  const STRIP_PREFIXES = [
    "tests",
    "vitest.config.ts",
    "extension",
    "cli",
    ".github",
    ".claude",
    "audits",
    "eslint.config.mjs",
    ".prettierignore",
    "components.json",
    "Dockerfile",
    ".dockerignore",
    "LICENSE",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY-POSTURE.md",
  ];

  it("passes exactly the protected and strip lists to pruneExtraneous", async () => {
    const job = createJob("v9.9.9", 1)!;
    await runUpdateJob(job.id, "v9.9.9");

    expect(mockPruneExtraneous).toHaveBeenCalledTimes(1);
    const opts = mockPruneExtraneous.mock.calls[0][2] as {
      protectedNames: string[];
      protectedPrefixes: string[];
      stripPrefixes: string[];
    };
    expect(opts.protectedNames).toEqual(PROTECTED_NAMES);
    expect(opts.protectedPrefixes).toEqual(PROTECTED_PREFIXES);
    expect(opts.stripPrefixes).toEqual(STRIP_PREFIXES);
  });

  it("excludes every protected AND strip path from the overlay copy too", async () => {
    const job = createJob("v9.9.9", 1)!;
    await runUpdateJob(job.id, "v9.9.9");

    const opts = mockCopyTreeOverlay.mock.calls[0][2] as {
      excludeNames: string[];
      excludePrefixes: string[];
    };
    expect(opts.excludeNames).toEqual(PROTECTED_NAMES);
    for (const p of [...PROTECTED_PREFIXES, ...STRIP_PREFIXES]) {
      expect(opts.excludePrefixes).toContain(p);
    }
  });

  it("copies before it prunes, never the other way round", async () => {
    const order: string[] = [];
    mockCopyTreeOverlay.mockImplementation(async () => {
      order.push("copy");
      return { filesCopied: 1, dirsCreated: 0, skipped: [] };
    });
    mockPruneExtraneous.mockImplementation(async () => {
      order.push("prune");
      return { filesDeleted: 0, dirsDeleted: 0 };
    });
    const job = createJob("v9.9.9", 1)!;

    await runUpdateJob(job.id, "v9.9.9");

    expect(order).toEqual(["copy", "prune"]);
  });
});

describe("runUpdateJob: install and migrate", () => {
  it("runs npm ci then the migration, and completes", async () => {
    const job = createJob("v9.9.9", 1)!;
    await runUpdateJob(job.id, "v9.9.9");

    const commands = mockRunCommand.mock.calls.map(
      ([cmd, args]) => `${cmd} ${(args as string[]).join(" ")}`,
    );
    expect(commands).toContain("npm ci");
    expect(commands).toContain("npm run db:migrate -- --yes");
    // Deliberately no build: the module comment explains the admin builds and
    // restarts themselves afterward.
    expect(commands.some((c) => c.includes("run build"))).toBe(false);
    expect(getJob(job.id)!.status).toBe("completed");
  });

  it("fails the job when npm ci exits non-zero, before the migration runs", async () => {
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "npm" && args[0] === "ci")
        return { code: 1, timedOut: false };
      return { code: 0, timedOut: false };
    });
    const job = createJob("v9.9.9", 1)!;

    await runUpdateJob(job.id, "v9.9.9");

    const ran = mockRunCommand.mock.calls.map(
      ([cmd, args]) => `${cmd} ${(args as string[]).join(" ")}`,
    );
    expect(ran).not.toContain("npm run db:migrate -- --yes");
    expect(getJob(job.id)!.status).toBe("failed");
  });

  it("fails the job when the database migration exits non-zero", async () => {
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("db:migrate")) return { code: 3, timedOut: false };
      return { code: 0, timedOut: false };
    });
    const job = createJob("v9.9.9", 1)!;

    await runUpdateJob(job.id, "v9.9.9");

    const finished = getJob(job.id)!;
    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("db:migrate");
    expect(finished.steps.find((s) => s.name === "db-migrate")?.status).toBe(
      "failed",
    );
  });

  it("aborts before touching the install directory when tar is missing", async () => {
    mockCommandAvailable.mockResolvedValue(false);
    const job = createJob("v9.9.9", 1)!;

    await runUpdateJob(job.id, "v9.9.9");

    expect(mockCopyTreeOverlay).not.toHaveBeenCalled();
    expect(getJob(job.id)!.error).toContain("tar");
  });

  it("attributes a mid-step throw to the step that was in flight", async () => {
    // Without this the admin UI's "don't restart, files are half-copied"
    // warning never fires: the step stays stuck at "running".
    mockCopyTreeOverlay.mockRejectedValue(new Error("ENOSPC: disk full"));
    const job = createJob("v9.9.9", 1)!;

    await runUpdateJob(job.id, "v9.9.9");

    const finished = getJob(job.id)!;
    expect(finished.status).toBe("failed");
    const copyStep = finished.steps.find((s) => s.name === "copy");
    expect(copyStep?.status).toBe("failed");
    expect(copyStep?.detail).toContain("ENOSPC");
  });
});
