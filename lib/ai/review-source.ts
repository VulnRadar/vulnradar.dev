/**
 * AI code review pass for GitHub repo scans.
 *
 * Analogous to lib/ai/verify-findings.ts's approach (same provider
 * resolution: a user's own configured AI endpoint first, VulnRadar's
 * server endpoint otherwise) but prompts the model to find NEW issues in
 * source files — hardcoded secrets the pattern scan might have missed,
 * injection risks, insecure crypto usage, auth/authorization logic flaws,
 * unsafe deserialization — rather than verifying existing findings.
 *
 * Token accounting: the route reserves estimateGithubReviewTokens out of the
 * window and the credit balance before the run (lib/billing/
 * github-review-usage.ts's reserveGithubReviewTokens), the run is held to
 * that reservation, and the route settles it with the REAL usage the
 * provider reported in its `usage` fields. The input-only estimate
 * (lib/scanner/github-repo-scan.ts's estimateTokens) is still the separate,
 * always-enforced per-run ceiling.
 */

import type { Category, Severity, Vulnerability } from "@/lib/scanner/types";
import type { RepoFile } from "@/lib/scanner/github-repo-scan";
import { estimateTokens } from "@/lib/scanner/github-repo-scan";
import {
  resolveServerEndpoint,
  resolveUserEndpoint,
  type AiEndpoint,
} from "./verify-findings";
import { getSettings } from "@/lib/config/runtime-config";
import { APP_NAME } from "@/lib/config/constants";
import { postChatCompletion } from "@/lib/ai/transport";
import { resolveAiCallTimeoutMs } from "@/lib/ai/reasoning";

const REVIEW_SYSTEM_PROMPT_BASE = `You are a security code reviewer for ${APP_NAME}, a vulnerability scanner. You are given source files from a user's GitHub repository, each line prefixed with its line number. Review the code that is actually in front of you.

WHAT THE REPOSITORY MIGHT BE
It can be ANY kind of software project: a web app, a CLI tool, a Discord or Slack bot, a game, a library, a Terraform module, a build script, a dotfiles repo. Do not assume it is a website. Never report missing HTTP security headers, cookie flags, TLS settings, or anything else that only describes a live server's response: a different part of ${APP_NAME} scans running sites, and this pass reviews source.

WHAT COUNTS AS A FINDING
Hardcoded secrets and credentials, injection (SQL, OS command, path traversal, XSS, SSRF, template, LDAP, XPath), insecure or homegrown cryptography, authentication and authorization logic flaws, unsafe deserialization, insecure randomness where it protects something, TOCTOU and race conditions on a security decision, unsafe file or archive handling (zip slip, symlink following), and prototype pollution.

READ BEFORE YOU REPORT: THE EVIDENCE RULE
A finding is a claim about this code, and a wrong claim costs the user more than a missed one costs you. State only what the code in front of you shows.

Report an issue only when ALL of these hold:
  1. You can name the exact file and line, and quote the code at it.
  2. The dangerous value reaches the dangerous call. Trace it. A variable named "query" near a string concat is not SQL injection; a concatenated string PASSED to db.query is.
  3. The input is attacker-influenced in some realistic use of this code. A hardcoded local path, a value from the repo's own config, or a literal in a test fixture is not attacker input.
  4. Nothing between the two already neutralises it: a parameterised query, an allowlist check, an escape or encode call, a type that cannot hold the payload, a framework that escapes by default.

Do NOT report:
  - Anything you would phrase as "could be", "may be", "if this is used with", "consider", or "it is recommended". Uncertainty is a reason not to file, not a hedge to attach.
  - Style, formatting, missing tests, missing docs, dependency versions, TODO comments, or dead code. None of those are security findings.
  - The same pattern over and over. One representative finding per distinct root cause, at the line that best shows it.
  - Code that only runs in tests, fixtures, examples, mocks, or documentation, unless it ships a real credential.
  - A construct that is only dangerous in a language or framework this file is not written in.

PLACEHOLDERS AND FAKE SECRETS
Before calling a value in .env, .env.example, a sample config, a docker-compose file, or a test a leaked secret, ask whether it is a placeholder: "your_key_here", "changeme", "xxxxxxxx", "REPLACE_ME", "sk-test-...", "password", "example", an empty string, or an obviously fabricated repeating pattern. Placeholders are not findings. Report a value only when it is shaped like a real credential: right length, right prefix, right alphabet, high entropy.

SEVERITY
critical: remote attacker gets code execution, data exfiltration, or auth bypass with no preconditions. A live production credential in a public repo.
high: a clear attack path with a realistic precondition, or a real credential that is not yet public.
medium: exploitable only under specific conditions, or a weakness that meaningfully helps an attacker who is already partway in.
low: defence in depth. Real, but on its own it does not get anyone anything.
info: worth the maintainer knowing, no direct risk.
Rate the code as written, not the worst thing that could happen if it were written differently.

CONFIDENCE
Give every finding a "confidence" from 0 to 100: how sure you are that this is real and exploitable as written, not how bad it would be. Above 85 means you traced it end to end and could write the exploit. 60 to 85 means the path is clear but one link is inferred. Below 60 means you are guessing, and a guess should not be a finding at all, so do not file it.

OUTPUT
Return ONLY a JSON array. No prose before or after it, no markdown fences, no explanation of your process. Each element:
{"file":"path/as/given","line":123,"severity":"critical|high|medium|low|info","confidence":90,"title":"short title","description":"what the issue is","evidence":"the exact code at that line that proves it","riskImpact":"what an attacker can actually do","explanation":"why this is a vulnerability","fixSteps":["step 1","step 2"]}

"file" must be copied character for character from a "--- FILE: ... ---" header above; a path you reword or guess is dropped. "line" must be a line number shown in that file. "evidence" must be code you can see, quoted, not a paraphrase.

Return an empty array [] if you find nothing worth reporting. An empty array is a correct and common answer for a well-written repository, and it is a better answer than a padded one. You are not scored on how many findings you produce.

Never use an em dash (—) anywhere in title, description, riskImpact, explanation, or fixSteps. Use a comma, colon, or a separate sentence instead.`;

function buildReviewSystemPrompt(isPrivate: boolean): string {
  const visibilityNote = isPrivate
    ? "This repository is PRIVATE: only its owner and collaborators can currently see this source. A hardcoded secret here is a real risk (it should still be rotated), but it is not yet publicly exposed; reflect that in severity/riskImpact rather than treating it as already leaked to the internet."
    : "This repository is PUBLIC: anyone on the internet can already see this exact source. Treat any hardcoded secret you find as already compromised and needing immediate rotation, since it's been visible the whole time this code has been public.";
  return `${REVIEW_SYSTEM_PROMPT_BASE}\n\n${visibilityNote}`;
}

interface RawFinding {
  file?: unknown;
  line?: unknown;
  severity?: unknown;
  confidence?: unknown;
  title?: unknown;
  description?: unknown;
  evidence?: unknown;
  riskImpact?: unknown;
  explanation?: unknown;
  fixSteps?: unknown;
}

/**
 * Below this, the prompt tells the model not to file at all, so a finding
 * that arrives under it is one the model itself called a guess. Dropping it
 * here is the only place that instruction is actually enforced.
 */
const MIN_REPORTABLE_CONFIDENCE = 60;

/**
 * What a finding scores when the model returns no `confidence` at all: an
 * older prompt's output, or a model that ignored the field. This is the value
 * every AI code-review finding used to carry unconditionally, so an endpoint
 * that never answers the field behaves exactly as it did before.
 */
const DEFAULT_REVIEW_CONFIDENCE = 60;

/** Clamp a model-reported confidence to 0-100, or fall back to the default. */
function parseConfidence(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_REVIEW_CONFIDENCE;
  }
  return Math.max(0, Math.min(100, Math.round(raw)));
}

const VALID_SEVERITIES: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];
const REVIEW_CATEGORY: Category = "code";

/**
 * Rough char budget per AI call so one call doesn't blow past a typical
 * model's context/output limits. Used only as the default parameter value
 * for batchFiles below; the shipped compiled default.
 */
const PER_CALL_CHAR_BUDGET = 40_000;

function buildFileBlock(file: RepoFile): string {
  const numbered = file.content
    .split("\n")
    .map((line, i) => `${i + 1}: ${line}`)
    .join("\n");
  return `--- FILE: ${file.path} ---\n${numbered}`;
}

/**
 * Groups items into call-sized batches by `sizeOf`. A single item larger than
 * the budget still gets its own batch. Shared by the run (file contents) and
 * the route's estimate (tree byte sizes) so both cut the repo the same way.
 */
function batchBySize<T>(
  items: T[],
  sizeOf: (item: T) => number,
  charBudget: number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const size = sizeOf(item);
    if (current.length > 0 && currentChars + size > charBudget) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Groups files into call-sized batches. A single file larger than the budget still gets its own batch. */
function batchFiles(
  files: RepoFile[],
  charBudget: number = PER_CALL_CHAR_BUDGET,
): RepoFile[][] {
  return batchBySize(files, (f) => f.content.length, charBudget);
}

/**
 * What the "N: " line prefixes and the "--- FILE ---" headers add to a
 * file's own size, as a share of it. Only the route's pre-fetch estimate
 * needs it (the run measures the prompt it actually built); a 20-character
 * average line with a 4-character prefix is 20%, rounded up.
 */
const PROMPT_FRAMING_ALLOWANCE = 0.25;

/** The longer of the two system prompts, so a ceiling holds for either. */
const SYSTEM_PROMPT_CHARS = Math.max(
  buildReviewSystemPrompt(true).length,
  buildReviewSystemPrompt(false).length,
);

/** The most one review call over `promptChars` of prompt can cost. */
function reviewCallCeiling(promptChars: number, maxTokensPerCall: number) {
  return estimateTokens(SYSTEM_PROMPT_CHARS + promptChars) + maxTokensPerCall;
}

/**
 * What a review of files with these byte sizes should reserve, from the tree
 * metadata alone, before any content is fetched: each call's input plus its
 * whole output allowance, batched the way runGithubAiReview will batch them.
 * The input-only GITHUB_REVIEW_MAX_TOKENS_PER_RUN check stays the ceiling on
 * what is sent; this is what the account is asked to cover.
 */
export async function estimateGithubReviewTokens(
  fileSizes: number[],
): Promise<number> {
  if (fileSizes.length === 0) return 0;
  const {
    GITHUB_REVIEW_MAX_TOKENS_PER_CALL: maxTokensPerCall,
    GITHUB_REVIEW_PER_CALL_CHAR_BUDGET: perCallCharBudget,
  } = await getSettings([
    "GITHUB_REVIEW_MAX_TOKENS_PER_CALL",
    "GITHUB_REVIEW_PER_CALL_CHAR_BUDGET",
  ] as const);
  return batchBySize(fileSizes, (s) => s, perCallCharBudget).reduce(
    (sum, batch) => {
      const chars = batch.reduce((n, s) => n + s, 0);
      return (
        sum +
        reviewCallCeiling(
          Math.ceil(chars * (1 + PROMPT_FRAMING_ALLOWANCE)),
          maxTokensPerCall,
        )
      );
    },
    0,
  );
}

function parseFindings(text: string, files: RepoFile[]): Vulnerability[] {
  const knownPaths = new Set(files.map((f) => f.path));
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const clean = noThink
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```/g, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const findings: Vulnerability[] = [];
  let idx = 0;
  for (const raw of parsed as (RawFinding | null)[]) {
    idx++;
    // The repo's own text steers what the model writes, so an element can be
    // anything JSON allows. A null one used to throw here.
    if (typeof raw !== "object" || raw === null) continue;
    if (typeof raw.file !== "string" || !knownPaths.has(raw.file)) continue;
    const severity = VALID_SEVERITIES.includes(raw.severity as Severity)
      ? (raw.severity as Severity)
      : "medium";
    const title =
      typeof raw.title === "string"
        ? raw.title.slice(0, 200)
        : "AI-reported code issue";
    const description =
      typeof raw.description === "string" ? raw.description.slice(0, 2000) : "";
    const evidence =
      typeof raw.evidence === "string" ? raw.evidence.slice(0, 2000) : "";
    const riskImpact =
      typeof raw.riskImpact === "string"
        ? raw.riskImpact.slice(0, 2000)
        : description;
    const explanation =
      typeof raw.explanation === "string"
        ? raw.explanation.slice(0, 2000)
        : description;
    const fixSteps = Array.isArray(raw.fixSteps)
      ? raw.fixSteps
          .filter((s): s is string => typeof s === "string")
          .slice(0, 10)
      : [];
    const line =
      typeof raw.line === "number" && Number.isFinite(raw.line) && raw.line > 0
        ? Math.floor(raw.line)
        : undefined;

    // The prompt says not to file below 60 because that is the model calling
    // its own finding a guess. Models comply with that unevenly, so the floor
    // is applied here as well as asked for there.
    const confidence = parseConfidence(raw.confidence);
    if (confidence < MIN_REPORTABLE_CONFIDENCE) continue;

    findings.push({
      id: `ai-code-review--${raw.file}--${line ?? 0}--${idx}`,
      title,
      severity,
      category: REVIEW_CATEGORY,
      description,
      evidence,
      riskImpact,
      explanation,
      fixSteps,
      codeExamples: [],
      confidence,
      detectionMethod: "AI code review",
      location: { file: raw.file, line },
    });
  }
  return findings;
}

interface CallResult {
  findings: Vulnerability[];
  totalTokens: number;
  /** The request went out and no usage figure came back (a timeout, a
   *  dropped connection, a provider that omits usage). */
  costUnknown?: boolean;
}

async function callReviewModel(
  endpoint: AiEndpoint,
  files: RepoFile[],
  maxTokens: number,
  timeoutMs: number,
  isPrivate: boolean,
): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const userPrompt = files.map(buildFileBlock).join("\n\n");
  const systemPrompt = buildReviewSystemPrompt(isPrivate);

  try {
    // Reasoning at the "verify" level: a code review is a judgement about
    // whether a specific line is exploitable, which is the same kind of
    // question finding verification asks and the same kind a snap answer gets
    // wrong. Which API the endpoint speaks is the transport's to decide. This
    // was the one caller that had never learned an Anthropic-shaped endpoint
    // has no /chat/completions, so repo scans posted into a 404 and reported
    // "no AI findings" for every repository.
    const res = await postChatCompletion(endpoint, {
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens,
      reasoning: "verify",
      scope: "AI-REVIEW",
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(
        `[AI-REVIEW] HTTP ${res.status} from ${endpoint.baseUrl}: ${res.detail.slice(0, 300)}`,
      );
      return { findings: [], totalTokens: 0 };
    }

    // The provider has billed this call whatever its answer says, so a
    // response that cannot be parsed keeps its token count. Losing it in the
    // catch below settled the call at zero and handed its cost back to the
    // account.
    let findings: Vulnerability[] = [];
    try {
      findings = parseFindings(res.text, files);
    } catch (err) {
      console.error(
        "[AI-REVIEW] Could not parse the review response:",
        err instanceof Error ? err.message : err,
      );
    }
    return {
      findings,
      totalTokens: res.tokensUsed,
      ...(res.tokensUsed > 0 ? {} : { costUnknown: true }),
    };
  } catch (err) {
    console.error(
      "[AI-REVIEW] callReviewModel failed:",
      err instanceof Error ? err.message : err,
    );
    return { findings: [], totalTokens: 0, costUnknown: true };
  } finally {
    clearTimeout(timer);
  }
}

export interface GithubAiReviewResult {
  findings: Vulnerability[];
  /** Real tokens spent across every call in this run. The caller settles its reservation with this. */
  totalTokensUsed: number;
  /** True if no AI endpoint could be resolved (server not configured, no user key) — findings will be empty. */
  noEndpoint: boolean;
  /** True if the estimated content size exceeded the per-run ceiling and the review was skipped entirely. */
  rejectedOverCap: boolean;
  /** True if the reservation could not cover the next batch, so the files from there on were not reviewed. */
  stoppedAtBudget: boolean;
}

/**
 * Runs the AI code review pass over `files` and returns findings shaped
 * like the existing Vulnerability type. Enforces the per-run token
 * ceiling defensively (the primary enforcement point is the caller, which
 * can estimate from GitHub tree metadata before ever fetching content —
 * see app/api/v3/scan/github/route.ts).
 *
 * `budgetTokens` is what the route's reserveGithubReviewTokens gate took for
 * this run, or null when nothing caps it (own key, billing off, the free
 * trial). Each batch is admitted at its worst case, so the run cannot spend
 * past the reservation. Nothing is recorded here: the route settles the
 * reservation with totalTokensUsed once the run is over. Recording per call
 * from here was the half of the old record-after-the-fact design that let a
 * run's charge land on a balance that had never covered it.
 */
export async function runGithubAiReview(
  files: RepoFile[],
  userId: number,
  isPrivate: boolean,
  budgetTokens: number | null,
): Promise<GithubAiReviewResult> {
  const nothing = {
    findings: [],
    totalTokensUsed: 0,
    noEndpoint: false,
    rejectedOverCap: false,
    stoppedAtBudget: false,
  };
  if (files.length === 0) return nothing;

  const endpoint =
    (await resolveUserEndpoint(userId)) ?? resolveServerEndpoint();
  if (!endpoint) return { ...nothing, noEndpoint: true };

  const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
  const {
    GITHUB_REVIEW_MAX_TOKENS_PER_RUN: maxTokensPerRun,
    GITHUB_REVIEW_CALL_TIMEOUT_MS: baseCallTimeoutMs,
    AI_REASONING_TIMEOUT_MULTIPLIER: reasoningTimeoutMultiplier,
    GITHUB_REVIEW_MAX_TOKENS_PER_CALL: maxTokensPerCall,
    GITHUB_REVIEW_PER_CALL_CHAR_BUDGET: perCallCharBudget,
  } = await getSettings([
    "GITHUB_REVIEW_MAX_TOKENS_PER_RUN",
    "GITHUB_REVIEW_CALL_TIMEOUT_MS",
    "AI_REASONING_TIMEOUT_MULTIPLIER",
    "GITHUB_REVIEW_MAX_TOKENS_PER_CALL",
    "GITHUB_REVIEW_PER_CALL_CHAR_BUDGET",
  ] as const);
  // A repo review sends tens of thousands of characters per call and asks for
  // reasoning on top, so it is the single slowest AI call the app makes. On
  // the flat timeout it was the first to be cut off, and a cut-off batch
  // returns no findings rather than partial ones.
  const callTimeoutMs = resolveAiCallTimeoutMs(
    endpoint.baseUrl,
    endpoint.model,
    "verify",
    baseCallTimeoutMs,
    reasoningTimeoutMultiplier,
  );
  if (estimateTokens(totalChars) > maxTokensPerRun) {
    return { ...nothing, rejectedOverCap: true };
  }

  const batches = batchFiles(files, perCallCharBudget);

  const findings: Vulnerability[] = [];
  let totalTokensUsed = 0;
  // What the budget check counts: each call's real cost, or its ceiling when
  // the cost is unknown (CallResult.costUnknown). Such a call is settled at
  // zero, but the provider may still have billed it, and counting it at zero
  // let a run whose calls all timed out send every batch.
  let held = 0;
  let stoppedAtBudget = false;

  for (const batch of batches) {
    let ceiling = 0;
    if (budgetTokens !== null) {
      const promptChars = batch.map(buildFileBlock).join("\n\n").length;
      ceiling = reviewCallCeiling(promptChars, maxTokensPerCall);
      if (held + ceiling > budgetTokens) {
        stoppedAtBudget = true;
        break;
      }
    }
    const result = await callReviewModel(
      endpoint,
      batch,
      maxTokensPerCall,
      callTimeoutMs,
      isPrivate,
    );
    findings.push(...result.findings);
    totalTokensUsed += result.totalTokens;
    held += result.costUnknown ? ceiling : result.totalTokens;
  }

  return {
    findings,
    totalTokensUsed,
    noEndpoint: false,
    rejectedOverCap: false,
    stoppedAtBudget,
  };
}
