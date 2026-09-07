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
 * Token accounting: every call's REAL usage (as reported by the provider
 * in its `usage` field) is added to the caller's monthly counter via
 * lib/billing/github-review-usage.ts, not a pre-run estimate. The
 * pre-run estimate (lib/scanner/github-repo-scan.ts's estimateTokens) is
 * only used for the separate, always-enforced per-run ceiling.
 */

import type { Category, Severity, Vulnerability } from "@/lib/scanner/types";
import type { RepoFile } from "@/lib/scanner/github-repo-scan";
import { estimateTokens } from "@/lib/scanner/github-repo-scan";
import {
  resolveServerEndpoint,
  resolveUserEndpoint,
  type AiEndpoint,
} from "./verify-findings";
import { recordGithubReviewTokens } from "@/lib/billing/github-review-usage";
import { getSettings } from "@/lib/config/runtime-config";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { isAnthropicProvider } from "@/lib/ai/provider";
import { callAnthropicMessages } from "@/lib/ai/anthropic";
import {
  resolveAnthropicThinkingBudget,
  resolveOpenAiCompatReasoningExtras,
  resolveAiCallTimeoutMs,
} from "@/lib/ai/reasoning";

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

/** Groups files into call-sized batches. A single file larger than the budget still gets its own batch. */
function batchFiles(
  files: RepoFile[],
  charBudget: number = PER_CALL_CHAR_BUDGET,
): RepoFile[][] {
  const batches: RepoFile[][] = [];
  let current: RepoFile[] = [];
  let currentChars = 0;

  for (const file of files) {
    const size = file.content.length;
    if (current.length > 0 && currentChars + size > charBudget) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(file);
    currentChars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
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
  for (const raw of parsed as RawFinding[]) {
    idx++;
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

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (endpoint.apiKey) headers["Authorization"] = `Bearer ${endpoint.apiKey}`;
  try {
    const host = new URL(endpoint.baseUrl).hostname.toLowerCase();
    if (host === "openrouter.ai") {
      // Identify THIS deployment to OpenRouter, not the SaaS: APP_URL already
      // resolves NEXT_PUBLIC_APP_URL first, so a self-hoster's AI spend is no
      // longer attributed to vulnradar.dev by a hardcoded fallback.
      headers["HTTP-Referer"] = APP_URL;
      headers["X-Title"] = APP_NAME;
    }
  } catch {
    /* ignore */
  }

  try {
    // Anthropic-shaped endpoints, which is Claude itself and any provider
    // reached on its /anthropic path (MiniMax among them), have no
    // /chat/completions at all. This was the ONE AI caller in the app that
    // never learned that, so pointing AI_BASE_URL at an Anthropic endpoint
    // left repo scans posting into a 404 and reporting "no AI findings" for
    // every repository, with only a line in the server log to say otherwise.
    if (isAnthropicProvider(endpoint.baseUrl)) {
      const { text, usage } = await callAnthropicMessages(
        {
          baseUrl: endpoint.baseUrl,
          apiKey: endpoint.apiKey,
          model: endpoint.model,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          maxTokens,
          thinkingBudgetTokens: resolveAnthropicThinkingBudget(maxTokens),
        },
        controller.signal,
      );
      return {
        findings: parseFindings(text, files),
        totalTokens: usage.inputTokens + usage.outputTokens,
      };
    }

    // Reasoning on the OpenAI-compatible path, at the "verify" level: a code
    // review is a judgement about whether a specific line is exploitable,
    // which is the same kind of question finding verification asks and the
    // same kind a snap answer gets wrong.
    const extras = resolveOpenAiCompatReasoningExtras(
      endpoint.baseUrl,
      endpoint.model,
      "verify",
    );
    const askedToReason = Object.keys(extras).length > 0;
    const baseBody: Record<string, unknown> = {
      model: endpoint.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    };
    const post = (body: Record<string, unknown>) =>
      fetch(`${endpoint.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

    let res = await post({ ...baseBody, ...extras });
    // A strict endpoint answers an unknown body field with a 400. Losing a
    // whole batch of files over an optional quality knob is the wrong trade,
    // so drop the field and ask once more. Same recovery as
    // lib/ai/verify-findings.ts.
    if (!res.ok && res.status === 400 && askedToReason) {
      let refusal = "";
      try {
        refusal = await res.clone().text();
      } catch {
        /* ignore */
      }
      if (/reasoning/i.test(refusal)) {
        console.error(
          `[AI-REVIEW] ${endpoint.model} refused reasoning_effort; retrying without it.`,
        );
        res = await post(baseBody);
      }
    }

    if (!res.ok) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        /* ignore */
      }
      console.error(
        `[AI-REVIEW] HTTP ${res.status} from ${endpoint.baseUrl}: ${body.slice(0, 300)}`,
      );
      return { findings: [], totalTokens: 0 };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const text = data?.choices?.[0]?.message?.content;
    const usage = data?.usage;
    const totalTokens =
      typeof usage?.total_tokens === "number"
        ? usage.total_tokens
        : (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);

    if (typeof text !== "string") return { findings: [], totalTokens };

    return { findings: parseFindings(text, files), totalTokens };
  } catch (err) {
    console.error(
      "[AI-REVIEW] callReviewModel failed:",
      err instanceof Error ? err.message : err,
    );
    return { findings: [], totalTokens: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export interface GithubAiReviewResult {
  findings: Vulnerability[];
  /** Real tokens spent across every call in this run (already recorded to the monthly counter, unless usingOwnAi). */
  totalTokensUsed: number;
  /** True if no AI endpoint could be resolved (server not configured, no user key) — findings will be empty. */
  noEndpoint: boolean;
  /** True if the estimated content size exceeded the per-run ceiling and the review was skipped entirely. */
  rejectedOverCap: boolean;
}

/**
 * Runs the AI code review pass over `files` and returns findings shaped
 * like the existing Vulnerability type. Enforces the per-run token
 * ceiling defensively (the primary enforcement point is the caller, which
 * can estimate from GitHub tree metadata before ever fetching content —
 * see app/api/v3/scan/github/route.ts) and records real usage to the
 * monthly counter after each call, except when `usingOwnAi` is true.
 */
export async function runGithubAiReview(
  files: RepoFile[],
  userId: number,
  usingOwnAi: boolean,
  isPrivate: boolean,
  creditCovered = false,
): Promise<GithubAiReviewResult> {
  if (files.length === 0) {
    return {
      findings: [],
      totalTokensUsed: 0,
      noEndpoint: false,
      rejectedOverCap: false,
    };
  }

  const endpoint =
    (await resolveUserEndpoint(userId)) ?? resolveServerEndpoint();
  if (!endpoint) {
    return {
      findings: [],
      totalTokensUsed: 0,
      noEndpoint: true,
      rejectedOverCap: false,
    };
  }

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
    return {
      findings: [],
      totalTokensUsed: 0,
      noEndpoint: false,
      rejectedOverCap: true,
    };
  }

  const batches = batchFiles(files, perCallCharBudget);

  const findings: Vulnerability[] = [];
  let totalTokensUsed = 0;

  for (const batch of batches) {
    const result = await callReviewModel(
      endpoint,
      batch,
      maxTokensPerCall,
      callTimeoutMs,
      isPrivate,
    );
    findings.push(...result.findings);
    totalTokensUsed += result.totalTokens;

    if (result.totalTokens > 0 && !usingOwnAi) {
      try {
        await recordGithubReviewTokens(
          userId,
          result.totalTokens,
          undefined,
          creditCovered,
        );
      } catch (err) {
        console.error(
          "[AI-REVIEW] Failed to record token usage (non-fatal):",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return {
    findings,
    totalTokensUsed,
    noEndpoint: false,
    rejectedOverCap: false,
  };
}
