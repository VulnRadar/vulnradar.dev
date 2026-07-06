import pool from "@/lib/database/db";
import { decryptApiKey } from "@/lib/auth/crypto";
import type { Vulnerability } from "@/lib/scanner/types";
import { VERIFY_SYSTEM_PROMPT } from "./verify-context";
import {
  AI_VERIFY_MAX_TOKENS,
  AI_VERIFY_CALL_TIMEOUT_MS,
  AI_VERIFY_PROBE_TIMEOUT_MS,
  AI_VERIFY_TOTAL_TIMEOUT_MS,
} from "@/lib/config/constants";

type AiVerdict = "confirmed" | "possible_fp" | "uncertain";

interface VerifyResult {
  id: string;
  verdict: AiVerdict;
  confidence: number;
  reason: string;
}

interface AiEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ProbeData {
  status_code: number;
  final_url: string;
  response_headers: Record<string, string>;
  body_snippet: string;
  error?: string;
}

function resolveServerEndpoint(): AiEndpoint | null {
  let baseUrl = process.env.AI_BASE_URL?.replace(/\/$/, "") ?? null;

  if (!baseUrl) {
    const provider = process.env.AI_PROVIDER?.toLowerCase();
    if (!provider) return null;
    const KNOWN: Record<string, string> = {
      openai: "https://api.openai.com/v1",
      anthropic: "https://api.anthropic.com/v1",
      minimax: "https://api.minimax.chat/v1",
      groq: "https://api.groq.com/openai/v1",
      mistral: "https://api.mistral.ai/v1",
      openrouter: "https://openrouter.ai/api/v1",
      ollama: "http://localhost:11434/v1",
      lmstudio: "http://localhost:1234/v1",
      together: "https://api.together.xyz/v1",
      deepseek: "https://api.deepseek.com/v1",
    };
    baseUrl = KNOWN[provider] ?? null;
  }

  if (!baseUrl) return null;

  let model = process.env.AI_MODEL ?? "";
  if (!model) {
    try {
      const u = new URL(baseUrl);
      const host = u.hostname.toLowerCase();
      const port = u.port;
      if (host === "api.anthropic.com") model = "claude-haiku-4-5-20251001";
      else if (host === "api.groq.com") model = "llama-3.3-70b-versatile";
      else if (host === "api.mistral.ai") model = "mistral-small-latest";
      else if (host === "openrouter.ai") model = "openai/gpt-4o-mini";
      else if (host === "api.together.xyz")
        model = "meta-llama/Llama-3.3-70B-Instruct-Turbo";
      else if (port === "11434") model = "llama3.2";
      else if (port === "1234") model = "local-model";
      else model = "gpt-4o-mini";
    } catch {
      model = "gpt-4o-mini";
    }
  }

  return { baseUrl, apiKey: process.env.AI_API_KEY ?? "", model };
}

async function resolveUserEndpoint(userId: number): Promise<AiEndpoint | null> {
  try {
    const result = await pool.query(
      `SELECT use_vulnradar_ai, model_id, api_key_encrypted, base_url
       FROM user_ai_configs WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.use_vulnradar_ai ||
      !row.base_url ||
      !row.model_id ||
      !row.api_key_encrypted
    ) {
      return null;
    }
    let apiKey: string;
    try {
      apiKey = decryptApiKey(row.api_key_encrypted as string);
    } catch {
      return null;
    }
    return {
      baseUrl: (row.base_url as string).replace(/\/$/, ""),
      model: row.model_id as string,
      apiKey,
    };
  } catch {
    return null;
  }
}

async function probeTarget(targetUrl: string): Promise<ProbeData> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    AI_VERIFY_PROBE_TIMEOUT_MS,
  );

  const ensuredUrl = /^https?:\/\//i.test(targetUrl)
    ? targetUrl
    : `https://${targetUrl}`;

  try {
    const res = await fetch(ensuredUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "VulnRadar-AI/1.0 (security verification probe)",
        Accept: "text/html,application/xhtml+xml,application/json,*/*",
      },
    });

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v: string, k: string) => {
      responseHeaders[k.toLowerCase()] = v;
    });

    let bodySnippet = "";
    try {
      const text = await res.text();
      bodySnippet = text.slice(0, 8192);
    } catch {
      /* ignore body read failures */
    }

    return {
      status_code: res.status,
      final_url: res.url,
      response_headers: responseHeaders,
      body_snippet: bodySnippet,
    };
  } catch (err) {
    return {
      status_code: 0,
      final_url: ensuredUrl,
      response_headers: {},
      body_snippet: "",
      error: err instanceof Error ? err.message : "probe failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callVerify(
  url: string,
  finding: Vulnerability,
  endpoint: AiEndpoint,
  probe: ProbeData,
): Promise<VerifyResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_VERIFY_CALL_TIMEOUT_MS);

  const probeSection = probe.error
    ? `live_probe: { "error": "${probe.error}" }`
    : `live_probe: ${JSON.stringify(
        {
          status_code: probe.status_code,
          final_url: probe.final_url,
          response_headers: probe.response_headers,
          body_snippet: probe.body_snippet,
        },
        null,
        2,
      )}`;

  const prompt = `Verify this VulnRadar finding using the live probe data below.

finding_id: ${finding.id}
title: ${finding.title}
category: ${finding.category}
severity: ${finding.severity}
evidence: ${finding.evidence}

${probeSection}

Return only JSON: {"verdict":"confirmed|possible_fp|uncertain","confidence":60-97,"reason":"one sentence citing specific live evidence"}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (endpoint.apiKey) headers["Authorization"] = `Bearer ${endpoint.apiKey}`;

  try {
    const host = new URL(endpoint.baseUrl).hostname.toLowerCase();
    if (host === "openrouter.ai") {
      headers["HTTP-Referer"] =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://vulnradar.dev";
      headers["X-Title"] = "VulnRadar";
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
        max_tokens: AI_VERIFY_MAX_TOKENS,
        messages: [
          { role: "system", content: VERIFY_SYSTEM_PROMPT },
          { role: "user", content: prompt },
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
        `[AI-VERIFY] HTTP ${res.status} from ${endpoint.baseUrl} for "${finding.id}": ${body.slice(0, 300)}`,
      );
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;

    const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const clean = noThink
      .replace(/```(?:json)?\s*/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(clean) as Record<string, unknown>;

    const verdict = parsed.verdict;
    if (
      verdict !== "confirmed" &&
      verdict !== "possible_fp" &&
      verdict !== "uncertain"
    )
      return null;

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.min(97, Math.max(60, Math.round(parsed.confidence)))
        : 70;
    const reason =
      typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "";

    return { id: finding.id, verdict, confidence, reason };
  } catch (err) {
    console.error(
      `[AI-VERIFY] callVerify failed for "${finding.id}":`,
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyFindingsBatch(
  url: string,
  findings: Vulnerability[],
  userId?: number | null,
): Promise<Vulnerability[]> {
  if (findings.length === 0) return findings;

  const endpoint =
    (userId ? await resolveUserEndpoint(userId) : null) ??
    resolveServerEndpoint();

  if (!endpoint) return findings;

  const probe = await probeTarget(url);

  const calls = findings.map((f) => callVerify(url, f, endpoint, probe));
  const timeoutFallback = new Promise<
    PromiseSettledResult<VerifyResult | null>[]
  >((resolve) => setTimeout(() => resolve([]), AI_VERIFY_TOTAL_TIMEOUT_MS));
  const settled = await Promise.race([
    Promise.allSettled(calls),
    timeoutFallback,
  ]);

  const verdictMap = new Map<string, Omit<VerifyResult, "id">>();
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) {
      const { id, ...rest } = r.value;
      verdictMap.set(id, rest);
    }
  }

  return findings.map((f) => {
    const v = verdictMap.get(f.id);
    if (!v) return f;
    return {
      ...f,
      aiVerdict: v.verdict,
      aiConfidence: v.confidence,
      aiReason: v.reason,
    };
  });
}

export async function runAiVerification(
  url: string,
  findings: Vulnerability[],
  scanHistoryId: number,
  userId?: number | null,
): Promise<void> {
  if (findings.length === 0) return;

  const endpoint =
    (userId ? await resolveUserEndpoint(userId) : null) ??
    resolveServerEndpoint();

  if (!endpoint) {
    console.error(
      "[AI-VERIFY] No endpoint resolved — check AI_BASE_URL/AI_PROVIDER env vars or user AI config",
    );
    return;
  }

  console.error(
    `[AI-VERIFY] Starting verification: ${findings.length} findings, model=${endpoint.model}, base=${endpoint.baseUrl}`,
  );

  // Live probe the target once — all findings share this response data
  const probe = await probeTarget(url);
  console.error(
    `[AI-VERIFY] Probe result: status=${probe.status_code}, error=${probe.error ?? "none"}`,
  );

  // Verify every finding regardless of severity
  const calls = findings.map((f) => callVerify(url, f, endpoint, probe));

  const timeoutFallback = new Promise<
    PromiseSettledResult<VerifyResult | null>[]
  >((resolve) => setTimeout(() => resolve([]), AI_VERIFY_TOTAL_TIMEOUT_MS));

  const settled = await Promise.race([
    Promise.allSettled(calls),
    timeoutFallback,
  ]);

  const verdictMap = new Map<string, Omit<VerifyResult, "id">>();
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) {
      const { id, ...rest } = r.value;
      verdictMap.set(id, rest);
    }
  }

  if (verdictMap.size === 0) {
    console.error(
      `[AI-VERIFY] All ${findings.length} calls returned null or timed out — no verdicts to save`,
    );
    return;
  }

  const enriched = findings.map((f) => {
    const v = verdictMap.get(f.id);
    if (!v) return f;

    const tag =
      v.verdict === "possible_fp"
        ? "[AI-POSSIBLE-FP]"
        : v.verdict === "uncertain"
          ? "[AI-UNCERTAIN]  "
          : "[AI-CONFIRMED]  ";

    const lines = [
      `${tag} ${f.id}`,
      `  Site      : ${url}`,
      `  Check     : ${f.title}`,
      `  Category  : ${f.category}  |  Severity: ${f.severity}`,
      `  Evidence  : ${f.evidence.replace(/\n/g, " ↵ ").slice(0, 200)}`,
      `  Confidence: ${v.confidence}%`,
      `  AI Reason : ${v.reason}`,
    ];

    if (v.verdict === "possible_fp") {
      lines.push(
        `  → To fix   : Review check "${f.id.split("--")[0]}" — AI says this may be a false positive at this site.`,
      );
    } else if (v.verdict === "uncertain") {
      lines.push(
        `  → To fix   : Probe returned ambiguous data — consider adding more evidence fields to check "${f.id.split("--")[0]}".`,
      );
    }

    console.error(lines.join("\n"));

    return {
      ...f,
      aiVerdict: v.verdict,
      aiConfidence: v.confidence,
      aiReason: v.reason,
    };
  });

  // Dev summary — one place to see the full breakdown
  const confirmed = enriched.filter((f) => f.aiVerdict === "confirmed").length;
  const possibleFp = enriched.filter(
    (f) => f.aiVerdict === "possible_fp",
  ).length;
  const uncertain = enriched.filter((f) => f.aiVerdict === "uncertain").length;
  const skipped = enriched.filter((f) => !f.aiVerdict).length;

  console.error(
    `[AI-VERIFY] Done — confirmed: ${confirmed}  possible_fp: ${possibleFp}  uncertain: ${uncertain}  skipped/timed-out: ${skipped}  (${url})`,
  );

  try {
    await pool.query("UPDATE scan_history SET findings = $1 WHERE id = $2", [
      JSON.stringify(enriched),
      scanHistoryId,
    ]);
  } catch (err) {
    console.error(
      "[AI-VERIFY] DB update failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
