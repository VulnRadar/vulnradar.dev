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

const REVIEW_SYSTEM_PROMPT_BASE = `You are a security code reviewer for VulnRadar, a vulnerability scanner. You are given source files from a user's GitHub repository. This repository can be ANY kind of software project: a web app, a CLI tool, a Discord/Slack bot, a game, a library, a build/infra script, anything. Do not assume it's a website. Do not report missing HTTP security headers, cookie flags, or other issues that only make sense for a live web server's response. Review the code itself.

Find real, specific security issues: hardcoded secrets/credentials, injection risks (SQL, command, path traversal, XSS, SSRF), insecure cryptography, authentication/authorization logic flaws, unsafe deserialization, and similar concrete vulnerabilities.

Only report issues you can point to a specific file and line for. Do not report generic style advice, missing tests, or anything that isn't a security issue. Do not repeat the same issue for every occurrence of a pattern. Report each distinct occurrence separately with its own file/line.

Before reporting a value in a .env, .env.example, or other config/template file as a leaked secret, check whether it's an obvious placeholder (e.g. "your_key_here", "changeme", "xxxxxxxx", empty). Placeholders in a template file are not findings: only report a value there if it's shaped like a real credential.

Return ONLY a JSON array (no prose, no markdown fences). Each element:
{"file":"path/as/given","line":123,"severity":"critical|high|medium|low|info","title":"short title","description":"what the issue is","evidence":"the specific code or line that proves it","riskImpact":"what an attacker can actually do","explanation":"why this is a vulnerability","fixSteps":["step 1","step 2"]}

Return an empty array [] if you find nothing worth reporting.

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
  title?: unknown;
  description?: unknown;
  evidence?: unknown;
  riskImpact?: unknown;
  explanation?: unknown;
  fixSteps?: unknown;
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
      confidence: 60,
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
    const res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: endpoint.model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: buildReviewSystemPrompt(isPrivate) },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

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
    GITHUB_REVIEW_CALL_TIMEOUT_MS: callTimeoutMs,
    GITHUB_REVIEW_MAX_TOKENS_PER_CALL: maxTokensPerCall,
    GITHUB_REVIEW_PER_CALL_CHAR_BUDGET: perCallCharBudget,
  } = await getSettings([
    "GITHUB_REVIEW_MAX_TOKENS_PER_RUN",
    "GITHUB_REVIEW_CALL_TIMEOUT_MS",
    "GITHUB_REVIEW_MAX_TOKENS_PER_CALL",
    "GITHUB_REVIEW_PER_CALL_CHAR_BUDGET",
  ] as const);
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
