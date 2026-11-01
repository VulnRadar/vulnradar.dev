import pool from "@/lib/database/db";
import { decryptApiKey } from "@/lib/auth/crypto";
import type { Vulnerability } from "@/lib/scanner/types";
import { safeFetch } from "@/lib/scanner/safe-fetch";
import { safeReadBody } from "@/lib/scanner/read-bounded-body";
import { getSetCookies } from "@/lib/scanner/_helpers";
import { VERIFY_SYSTEM_PROMPT } from "./verify-context";
import { resolveAiBaseUrl, resolveAiDefaultModel } from "@/lib/ai/provider";
import { postChatCompletion, type AiEndpoint } from "@/lib/ai/transport";
import { resolveAiCallTimeoutMs } from "@/lib/ai/reasoning";
import { getSettings } from "@/lib/config/runtime-config";
import { APP_NAME } from "@/lib/config/constants";
import {
  settleAiTokens,
  type AiTokenReservation,
} from "@/lib/billing/ai-usage";

type AiVerdict = "confirmed" | "possible_fp" | "uncertain";

interface VerifyResult {
  id: string;
  verdict: AiVerdict;
  confidence: number;
  reason: string;
}

// The endpoint type lives with the transport that sends to it. It stays
// exported from here as well because this module is where an endpoint is
// resolved (lib/ai/review-source.ts, scan-summary.ts and auto-tag-suggest.ts
// all import the resolvers and the type together), so that DB lookup and
// env-var resolution is not duplicated by each of them.
export type { AiEndpoint };

export interface ProbeData {
  status_code: number;
  final_url: string;
  // Almost every header is a single value, but Set-Cookie is not: a site
  // that sets several cookies in one response emits multiple Set-Cookie
  // headers, so that key alone can be an array here. See probeTarget below
  // for why this can't just be flattened back to a string.
  response_headers: Record<string, string | string[]>;
  body_snippet: string;
  error?: string;
}

interface VerifySettings {
  maxTokens: number;
  chunkSize: number;
  callTimeoutMs: number;
  reasoningTimeoutMultiplier: number;
  probeTimeoutMs: number;
  totalTimeoutMs: number;
  probeBodySnippetChars: number;
}

/**
 * Resolves the admin-editable AI settings once per batch (not once per
 * finding), so a scan with hundreds of findings issues a single settings
 * lookup instead of one per AI call.
 */
async function resolveVerifySettings(): Promise<VerifySettings> {
  const settings = await getSettings([
    "AI_VERIFY_MAX_TOKENS",
    "AI_VERIFY_CHUNK_SIZE",
    "AI_VERIFY_CALL_TIMEOUT_MS",
    "AI_REASONING_TIMEOUT_MULTIPLIER",
    "AI_VERIFY_PROBE_TIMEOUT_MS",
    "AI_VERIFY_TOTAL_TIMEOUT_MS",
    "AI_VERIFY_PROBE_BODY_SNIPPET_CHARS",
  ] as const);
  return {
    maxTokens: settings.AI_VERIFY_MAX_TOKENS,
    chunkSize: settings.AI_VERIFY_CHUNK_SIZE,
    callTimeoutMs: settings.AI_VERIFY_CALL_TIMEOUT_MS,
    reasoningTimeoutMultiplier: settings.AI_REASONING_TIMEOUT_MULTIPLIER,
    probeTimeoutMs: settings.AI_VERIFY_PROBE_TIMEOUT_MS,
    totalTimeoutMs: settings.AI_VERIFY_TOTAL_TIMEOUT_MS,
    probeBodySnippetChars: settings.AI_VERIFY_PROBE_BODY_SNIPPET_CHARS,
  };
}

export function resolveServerEndpoint(): AiEndpoint | null {
  const baseUrl = resolveAiBaseUrl();
  if (!baseUrl) return null;
  const model = process.env.AI_MODEL || resolveAiDefaultModel(baseUrl);
  return { baseUrl, apiKey: process.env.AI_API_KEY ?? "", model };
}

/**
 * Users whose saved AI key has already been reported as unreadable by this
 * process. A key that does not decrypt is a standing fact about a stored row,
 * not an event: resolveUserEndpoint runs for every verification, summary, tag
 * suggestion and quota check, so reporting it each time would be an error row
 * per request for as long as the row stays that way. A user is dropped from
 * the set the moment their key reads again, so a second breakage is reported.
 */
const unreadableKeyReported = new Set<number>();

function reportUnreadableUserKey(userId: number, err: unknown): void {
  if (unreadableKeyReported.has(userId)) return;
  unreadableKeyReported.add(userId);
  // The cause is the decrypt error's message, which never carries the value
  // being decrypted. The ciphertext itself is deliberately not logged.
  console.error(
    `[AI-ENDPOINT] The saved AI key for user ${userId} does not decrypt, so their AI calls use the instance's AI instead of their own. If API_KEY_ENCRYPTION_KEY was rotated, set PREVIOUS_API_KEY_ENCRYPTION_KEY to the old value; otherwise the user has to save the key again (${err instanceof Error ? err.message : "decrypt failed"}). Reported once per process per user.`,
  );
}

/**
 * The AI endpoint a user configured for themselves, or null for everything
 * that means "use the instance's": no row, the VulnRadar AI option, an
 * incomplete row, and the two failures below.
 *
 * Both failures used to be silent, and both end the same way for the caller:
 * the instance's AI answers in place of the one the user chose. A saved key
 * that no longer decrypts (a rotated API_KEY_ENCRYPTION_KEY with no
 * PREVIOUS_API_KEY_ENCRYPTION_KEY set) and a lookup that threw both look,
 * from the outside, exactly like a user who never configured anything.
 * Neither changes what is returned; they are logged so an operator can tell
 * them apart.
 */
export async function resolveUserEndpoint(
  userId: number,
): Promise<AiEndpoint | null> {
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
    } catch (err) {
      reportUnreadableUserKey(userId, err);
      return null;
    }
    unreadableKeyReported.delete(userId);
    return {
      baseUrl: (row.base_url as string).replace(/\/$/, ""),
      model: row.model_id as string,
      apiKey,
    };
  } catch (err) {
    console.error(
      `[AI-ENDPOINT] Could not read the AI settings of user ${userId}, so their AI calls use the instance's AI:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function probeTarget(
  targetUrl: string,
  probeTimeoutMs: number,
  probeBodySnippetChars: number,
): Promise<ProbeData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), probeTimeoutMs);

  const ensuredUrl = /^https?:\/\//i.test(targetUrl)
    ? targetUrl
    : `https://${targetUrl}`;

  try {
    // ensuredUrl is attacker-influenced: verify-batch/route.ts passes the raw
    // request-body `url` straight through with no upstream validation, and
    // even the scan_history-sourced `url` in verify/route.ts could have been
    // re-pointed at an internal host via DNS rebinding since the original
    // scan ran. safeFetch (lib/scanner/safe-fetch.ts) is the shared SSRF
    // guard: it rejects private/internal hosts, re-resolves DNS, and
    // re-validates every redirect hop rather than blindly following them.
    const res = await safeFetch(ensuredUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": `${APP_NAME}-AI/1.0 (security verification probe)`,
        Accept: "text/html,application/xhtml+xml,application/json,*/*",
      },
    });

    // Headers.forEach() calls back once per raw Set-Cookie header (it does
    // NOT comma-join them the way Headers.get("set-cookie") does), but
    // collecting into a plain Record<string, string> keyed by lowercased
    // header name silently overwrote every earlier Set-Cookie entry with
    // the last one — a real scan's response_headers.set-cookie here would
    // only ever show the final cookie the target set, discarding the rest.
    // That's exactly what produced verification runs that only "saw" one
    // cookie on a response that set several: the AI wasn't wrong about what
    // was in response_headers, response_headers itself was already missing
    // the other cookies before the prompt was ever built. Capture Set-Cookie
    // separately via getSetCookie() (array, one entry per header) instead of
    // letting it fall through the same single-string path as every other
    // header.
    const responseHeaders: Record<string, string | string[]> = {};
    res.headers.forEach((v: string, k: string) => {
      const key = k.toLowerCase();
      if (key === "set-cookie") return;
      responseHeaders[key] = v;
    });
    const setCookies = getSetCookies(res.headers);
    if (setCookies.length > 0) responseHeaders["set-cookie"] = setCookies;

    let bodySnippet = "";
    try {
      // Raised from 8192: this is what the AI verifier is asked to
      // cross-check body-content findings (mixed-content, inline styles,
      // third-party scripts, autocomplete attributes, etc.) against. 8KB
      // rarely reaches past a real page's <head>, so the verifier was
      // routinely unable to see the very markup it was asked to confirm and
      // fell back on trusting the scanner's own claim (see verify-context.ts
      // for why that fallback is deliberate policy, not a bug on its own).
      // A larger, still-bounded snippet gives it a real shot at confirming
      // body-content findings directly instead of defaulting to "plausible."
      //
      // Read with the cap, not res.text() and a slice: the target chooses
      // the body, and on verify-batch the caller chooses the target, so an
      // endless or decompression-bomb response was buffered whole before a
      // character of it was dropped. The cap is in bytes, which is never
      // fewer characters than the slice this replaced kept.
      bodySnippet = await safeReadBody(
        res,
        probeBodySnippetChars,
        probeTimeoutMs,
      );
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

/**
 * Parses a verdict object out of the model's raw text. Tries a strict parse
 * first, then falls back to extracting the first `{...}` substring — a model
 * that prefixes its JSON with a stray sentence (despite the "return only
 * JSON" instruction) would otherwise fail JSON.parse on the whole response
 * and lose the finding entirely.
 */
function tryParseVerdictJson(clean: string): Record<string, unknown> | null {
  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch {
    /* fall through to substring extraction below */
  }
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseVerifyResponseText(
  findingId: string,
  text: string,
): VerifyResult | null {
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const clean = noThink
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```/g, "")
    .trim();

  if (!clean) return null;

  const parsed = tryParseVerdictJson(clean);
  const verdict = parsed?.verdict;
  if (
    verdict === "confirmed" ||
    verdict === "possible_fp" ||
    verdict === "uncertain"
  ) {
    const confidence =
      typeof parsed!.confidence === "number"
        ? Math.min(97, Math.max(60, Math.round(parsed!.confidence as number)))
        : 70;
    const reason =
      typeof parsed!.reason === "string"
        ? (parsed!.reason as string).trim()
        : "";
    return { id: findingId, verdict, confidence, reason };
  }

  // The model responded (HTTP 200, non-empty body) but didn't produce a
  // parseable verdict -- most often it hedged in prose instead of returning
  // JSON, typically because it felt it lacked enough evidence to decide.
  // Dropping the finding here (returning null) is how a finding silently
  // never gets reported on even though the AI did reply. Report it instead:
  // "uncertain", carrying the model's own full text as the reason (never
  // truncated, same as the confirmed/possible_fp path above), so every
  // finding sent to the AI comes back with SOME verdict and the user can
  // read exactly what the model actually said.
  return {
    id: findingId,
    verdict: "uncertain",
    confidence: 60,
    reason: `AI response was not a parseable verdict: ${clean}`,
  };
}

export function buildVerifyPrompt(
  finding: Vulnerability,
  probe: ProbeData,
): string {
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

  // evidenceExcerpts are the verbatim proof strings the original detector
  // already extracted (e.g. the exact script src or matched pattern) — much
  // smaller and more targeted than body_snippet, which is only the first
  // 8KB of the page and may not contain the match at all for content deep
  // in a large document. Passing them directly lets the AI confirm against
  // the same text the detector matched instead of re-deriving it (or giving
  // up) from a generic, possibly-irrelevant snippet.
  const excerptsSection =
    finding.evidenceExcerpts && finding.evidenceExcerpts.length > 0
      ? `\nevidence_excerpts: ${JSON.stringify(finding.evidenceExcerpts)}`
      : "";

  return `Verify this ${APP_NAME} finding using the live probe data below.

finding_id: ${finding.id}
title: ${finding.title}
category: ${finding.category}
severity: ${finding.severity}
evidence: ${finding.evidence}${excerptsSection}

${probeSection}

Return only JSON: {"verdict":"confirmed|possible_fp|uncertain","confidence":60-97,"reason":"one sentence citing specific live evidence, aim for roughly 300-500 characters but go longer if the evidence genuinely needs it"}`;
}

/**
 * Characters per token used for the worst-case ceiling below. Lower than the
 * 4 the repo review's estimate uses because most of a verify prompt is the
 * scanned page's HTML and its response headers, which tokenise denser than
 * prose, and an under-estimate here is what lets a run spend past its
 * reservation.
 */
const VERIFY_CHARS_PER_TOKEN_CEILING = 3;

/**
 * Room for the probe's response headers in the ceiling. Node's HTTP parser
 * refuses a header block over 16 KB by default, so a probe cannot carry more.
 */
const PROBE_HEADER_ALLOWANCE_CHARS = 16 * 1024;

const EMPTY_PROBE: ProbeData = {
  status_code: 0,
  final_url: "",
  response_headers: {},
  body_snippet: "",
};

/**
 * The most one finding's verification call can cost: the system prompt, the
 * finding's own prompt, a full-size probe snippet and header block, and the
 * whole output allowance. Computed without the probe so the route can reserve
 * before the probe runs and the run admits findings against the same number.
 */
export function verifyCallCeiling(
  finding: Vulnerability,
  settings: Pick<VerifySettings, "maxTokens" | "probeBodySnippetChars">,
): number {
  // verify-batch takes its findings from the request body, so an element can
  // be anything; a null one costs the bare template rather than throwing.
  const promptChars =
    VERIFY_SYSTEM_PROMPT.length +
    buildVerifyPrompt(finding ?? ({} as Vulnerability), EMPTY_PROBE).length +
    settings.probeBodySnippetChars +
    PROBE_HEADER_ALLOWANCE_CHARS;
  return (
    Math.ceil(promptChars / VERIFY_CHARS_PER_TOKEN_CEILING) + settings.maxTokens
  );
}

/**
 * What a verification pass over `findings` should reserve: `estimate` covers
 * every finding at its ceiling, `minimum` is the first finding's ceiling, the
 * least a run needs to verify anything (the pass admits findings in order and
 * stops at the first one its budget cannot cover).
 */
export async function estimateVerifyTokens(
  findings: Vulnerability[],
): Promise<{ estimate: number; minimum: number }> {
  if (findings.length === 0) return { estimate: 0, minimum: 0 };
  const settings = await resolveVerifySettings();
  const ceilings = findings.map((f) => verifyCallCeiling(f, settings));
  return {
    estimate: ceilings.reduce((sum, c) => sum + c, 0),
    minimum: ceilings[0],
  };
}

interface CallVerifyResult {
  result: VerifyResult | null;
  /** Real tokens the provider reported for this one call (0 if the call never reached a provider, or the provider omitted usage). */
  tokensUsed: number;
  /**
   * The provider answered 429. Distinct from every other failure because it
   * is the one where sending the NEXT finding is guaranteed to fail the same
   * way, and the one the user can act on (wait, or raise their plan).
   */
  rateLimited?: boolean;
  /**
   * The provider refused the credentials or does not know the model (401,
   * 403, 404). Like a 429, every remaining finding would fail the same way,
   * but unlike it waiting does not help: the configuration is wrong.
   */
  fatalStatus?: number;
}

/** Statuses after which no further finding in the pass can succeed. */
const FATAL_STATUSES = new Set([401, 403, 404]);

async function callVerify(
  url: string,
  finding: Vulnerability,
  endpoint: AiEndpoint,
  probe: ProbeData,
  settings: VerifySettings,
): Promise<CallVerifyResult> {
  const controller = new AbortController();
  // A reasoning model spends most of its wall clock before the first token,
  // and a finding that overruns lands as "no verdict" rather than
  // "uncertain", so the ceiling has to know what kind of call this is.
  const callTimeoutMs = resolveAiCallTimeoutMs(
    endpoint.baseUrl,
    endpoint.model,
    "verify",
    settings.callTimeoutMs,
    settings.reasoningTimeoutMultiplier,
  );
  const timer = setTimeout(() => controller.abort(), callTimeoutMs);
  const prompt = buildVerifyPrompt(finding, probe);

  try {
    // Reasoning on every API shape, not only Anthropic's. Without it every
    // GPT-5, o-series, Gemini 3 and Grok 4 verdict was a snap judgement, on a
    // question whose answer is shown to the user as a statement about their
    // security. An endpoint that refuses the field is retried without it by
    // the transport, so the verdict is not thrown away over a quality knob.
    const res = await postChatCompletion(endpoint, {
      system: VERIFY_SYSTEM_PROMPT,
      prompt,
      maxTokens: settings.maxTokens,
      reasoning: "verify",
      scope: "AI-VERIFY",
      signal: controller.signal,
    });

    if (!res.ok) {
      // A 429 is reported once, by verifyInChunks, for the whole pass: one
      // line per finding turned a single rate limit into dozens of identical
      // error-log rows. The transport hands both API shapes' failures back
      // as the same value, so this is the one place the mapping is written.
      if (res.status === 429) {
        return { result: null, tokensUsed: 0, rateLimited: true };
      }
      if (FATAL_STATUSES.has(res.status)) {
        return { result: null, tokensUsed: 0, fatalStatus: res.status };
      }
      console.error(
        `[AI-VERIFY] HTTP ${res.status} from ${endpoint.baseUrl} for "${finding.id}": ${res.detail.slice(0, 300)}`,
      );
      return { result: null, tokensUsed: 0 };
    }

    return {
      result: parseVerifyResponseText(finding.id, res.text),
      tokensUsed: res.tokensUsed,
    };
  } catch (err) {
    // A template string, not console.error's "%s" placeholder: the admin error
    // log (lib/database/error-log-capture.ts) records the raw arguments, so the
    // placeholder showed up there literally as `callVerify failed for "%s"`.
    console.error(
      `[AI-VERIFY] callVerify failed for "${finding.id}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return { result: null, tokensUsed: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifies findings in fixed-size concurrent chunks instead of firing every
 * finding at once. Two problems this fixes versus one big Promise.race
 * over the whole batch: unbounded fan-out can trip provider rate limits on
 * large scans, and racing a single global timeout against the whole batch
 * discards every result — including ones that already finished — the
 * instant the deadline hits. Chunking means only the chunk in flight when
 * the deadline passes is at risk, and onChunkDone lets the caller persist
 * verdicts incrementally so a scan with hundreds of findings keeps whatever
 * got verified even if it runs out of time before covering all of them.
 */
interface VerifyInChunksResult {
  verdictMap: Map<string, Omit<VerifyResult, "id">>;
  /** Sum of every call's real token usage across the whole batch, regardless of whether that call produced a usable verdict. */
  totalTokens: number;
  /** The provider rate-limited the pass, which was stopped there. */
  rateLimited: boolean;
  /** The reservation could not cover the next finding, so the pass stopped. */
  budgetExhausted: boolean;
}

/**
 * The next findings the budget can pay for, in order, up to one chunk. Stops
 * at the first finding that does not fit rather than skipping ahead to a
 * cheaper one, so what is left unverified is a contiguous tail the outcome
 * can describe.
 */
function admitWithinBudget(
  findings: Vulnerability[],
  remaining: number,
  settings: VerifySettings,
): Vulnerability[] {
  const admitted: Vulnerability[] = [];
  let room = remaining;
  for (const f of findings) {
    const ceiling = verifyCallCeiling(f, settings);
    if (ceiling > room) break;
    admitted.push(f);
    room -= ceiling;
  }
  return admitted;
}

async function verifyInChunks(
  url: string,
  findings: Vulnerability[],
  endpoint: AiEndpoint,
  probe: ProbeData,
  deadline: number,
  settings: VerifySettings,
  budget: number | null,
  spent: { tokens: number },
  onChunkDone?: (
    verdicts: Map<string, Omit<VerifyResult, "id">>,
  ) => Promise<void> | void,
): Promise<VerifyInChunksResult> {
  const verdictMap = new Map<string, Omit<VerifyResult, "id">>();
  let rateLimited = false;
  let budgetExhausted = false;
  let fatalStatus: number | undefined;

  let next = 0;
  while (next < findings.length) {
    if (Date.now() >= deadline) break;

    let group = findings.slice(next, next + settings.chunkSize);
    // Each call is admitted at its worst case, so the pass cannot spend past
    // what the gate reserved for it even if every call in a chunk comes back
    // at its ceiling. Real calls cost less, so the room they leave is used by
    // the chunks after them.
    if (budget !== null) {
      group = admitWithinBudget(group, budget - spent.tokens, settings);
      if (group.length === 0) {
        budgetExhausted = true;
        break;
      }
    }
    next += group.length;

    const settled = await Promise.allSettled(
      group.map((f) => callVerify(url, f, endpoint, probe, settings)),
    );

    for (const r of settled) {
      if (r.status === "fulfilled") {
        spent.tokens += r.value.tokensUsed;
        if (r.value.rateLimited) rateLimited = true;
        if (r.value.fatalStatus) fatalStatus = r.value.fatalStatus;
        if (r.value.result) {
          const { id, ...rest } = r.value.result;
          verdictMap.set(id, rest);
        }
      }
    }

    // Awaited so a slow chunk's persistence can't land after (and clobber)
    // a later, more-complete chunk's write.
    await onChunkDone?.(verdictMap);

    // Once the provider has said 429, every remaining chunk would be refused
    // the same way. It used to carry on regardless: a scan with forty
    // findings sent forty requests into the same limit, logged forty identical
    // errors, and made the limit last longer by adding to it.
    if (rateLimited) {
      console.error(
        `[AI-VERIFY] ${endpoint.baseUrl} rate-limited the pass for ${url}; stopped after ${verdictMap.size} of ${findings.length} verdicts.`,
      );
      break;
    }
    if (fatalStatus) {
      console.error(
        `[AI-VERIFY] ${endpoint.baseUrl} returned ${fatalStatus} for model ${endpoint.model} verifying ${url}; stopped after ${verdictMap.size} of ${findings.length} verdicts. Check the AI key and model.`,
      );
      break;
    }
  }

  return {
    verdictMap,
    totalTokens: spent.tokens,
    rateLimited,
    budgetExhausted,
  };
}

/**
 * Closes the route's reservation with the pass's real token count, which
 * returns the unused part of it (see settleAiTokens). Called from a finally,
 * so a pass that returns early or throws still gives the reservation back.
 * Non-fatal: a failure here never fails the surrounding verification call.
 */
async function settleVerifyTokens(
  reservation: AiTokenReservation | null,
  totalTokens: number,
): Promise<void> {
  if (!reservation) return;
  try {
    await settleAiTokens(reservation, totalTokens);
  } catch (err) {
    console.error(
      "[AI-VERIFY] Failed to settle token usage (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * verifyFindingsBatch, and whether the pass actually happened.
 *
 * verifyFindingsBatch hands back the findings and nothing else, so "the AI
 * looked and cleared everything", "no AI endpoint is configured" and "the
 * provider was down for every chunk" all arrive as the same array, and a route
 * that wraps it can only answer success. runAiVerification fixed that for the
 * scan page with AiVerificationOutcome; this gives the batch the same answer.
 *
 * Nothing is persisted and nothing extra is logged, exactly as for
 * verifyFindingsBatch, which now calls this: the caller has the outcome to act
 * on. A batch with nothing in it counts as configured, as it does for
 * runAiVerification, because no endpoint was looked for.
 *
 * `reservation` is what the route's reserveAiTokens gate took for this pass:
 * the pass is held to its budget and settles it with the real count. It is a
 * required argument on purpose, null only for a caller that charges nobody
 * (an evaluation run, a test), so a new route cannot verify on the operator's
 * key by forgetting the gate.
 */
export async function verifyFindingsBatchWithOutcome(
  url: string,
  findings: Vulnerability[],
  userId: number | null,
  reservation: AiTokenReservation | null,
): Promise<{ findings: Vulnerability[]; outcome: AiVerificationOutcome }> {
  const spent = { tokens: 0 };
  try {
    if (findings.length === 0) {
      return {
        findings,
        outcome: { configured: true, verdicts: 0, attempted: 0 },
      };
    }

    const endpoint =
      (userId ? await resolveUserEndpoint(userId) : null) ??
      resolveServerEndpoint();

    if (!endpoint) {
      return {
        findings,
        outcome: {
          configured: false,
          verdicts: 0,
          attempted: findings.length,
        },
      };
    }

    const settings = await resolveVerifySettings();
    const probe = await probeTarget(
      url,
      settings.probeTimeoutMs,
      settings.probeBodySnippetChars,
    );
    const deadline = Date.now() + settings.totalTimeoutMs;
    const { verdictMap, rateLimited, budgetExhausted } = await verifyInChunks(
      url,
      findings,
      endpoint,
      probe,
      deadline,
      settings,
      reservation?.budget ?? null,
      spent,
    );

    return {
      findings: applyVerdicts(findings, verdictMap),
      outcome: {
        configured: true,
        verdicts: verdictMap.size,
        attempted: findings.length,
        ...(rateLimited ? { rateLimited: true } : {}),
        ...(budgetExhausted ? { budgetExhausted: true } : {}),
      },
    };
  } finally {
    await settleVerifyTokens(reservation, spent.tokens);
  }
}

export async function verifyFindingsBatch(
  url: string,
  findings: Vulnerability[],
  userId: number | null,
  reservation: AiTokenReservation | null,
): Promise<Vulnerability[]> {
  const { findings: verified } = await verifyFindingsBatchWithOutcome(
    url,
    findings,
    userId,
    reservation,
  );
  return verified;
}

/**
 * Maps an AI verdict onto the user-facing "Mark this result" feedback
 * verdict (components/scanner/issue-detail.tsx's FindingFeedback, persisted
 * via app/api/v3/scan/feedback/route.ts's scan_finding_feedback table) so
 * a finding AI already confirmed or flagged as a likely false positive
 * shows up pre-marked instead of requiring the user to also click a button
 * for something the AI already decided. "uncertain" has no entry on
 * purpose: none of the three feedback options (confirmed/false_positive/
 * not_applicable) honestly represents "the AI couldn't tell", so that case
 * is left for a human to actually decide rather than guessed at.
 */
const AI_VERDICT_TO_FEEDBACK: Partial<Record<AiVerdict, string>> = {
  confirmed: "confirmed",
  possible_fp: "false_positive",
};

/**
 * Pre-fills "Mark this result" from the AI's own verdict, one row per
 * finding that has a mapped verdict (see AI_VERDICT_TO_FEEDBACK). Uses
 * ON CONFLICT DO NOTHING, not DO UPDATE: this only fills in a gap where
 * nothing has been decided yet. It never overwrites an existing row,
 * whether that row came from the user's own earlier click or from an
 * earlier AI-verify run, so "the user can change it if they disagree"
 * always wins once they've actually made a choice. Best-effort: a failure
 * here never fails the surrounding AI verification call.
 */
async function syncFeedbackFromAiVerdicts(
  userId: number | null | undefined,
  scanHistoryId: number | null | undefined,
  url: string,
  verdicts: Map<string, Omit<VerifyResult, "id">>,
): Promise<void> {
  if (!userId) return;

  const findingIds: string[] = [];
  const feedbackVerdicts: string[] = [];
  for (const [findingId, v] of verdicts) {
    const feedbackVerdict = AI_VERDICT_TO_FEEDBACK[v.verdict];
    if (!feedbackVerdict) continue;
    findingIds.push(findingId);
    feedbackVerdicts.push(feedbackVerdict);
  }
  if (findingIds.length === 0) return;

  // One statement for the whole chunk. This ran a query per finding, so a
  // chunk of ten meant ten round trips, and a failure that applied to all of
  // them (see below) was logged ten times over.
  const insert = (historyId: number | null) =>
    pool.query(
      `INSERT INTO scan_finding_feedback
         (user_id, scan_history_id, finding_id, finding_url, verdict, notes)
       SELECT $1, $2, f.finding_id, $3, f.verdict,
              'Set automatically from an AI verify verdict.'
         FROM UNNEST($4::text[], $5::text[]) AS f(finding_id, verdict)
       ON CONFLICT (user_id, finding_id, finding_url) DO NOTHING`,
      [userId, historyId, url, findingIds, feedbackVerdicts],
    );

  try {
    await insert(scanHistoryId ?? null);
  } catch (err) {
    // 23503 is foreign_key_violation: the scan row went away while we were
    // verifying it, which a delete or a "Clear history" during a run that
    // can last minutes will do. The verdicts are still worth keeping, and
    // the schema already says so: scan_history_id is nullable and the
    // constraint is ON DELETE SET NULL, so a feedback row is designed to
    // outlive its scan. Re-insert unlinked rather than throw the chunk away
    // and log a foreign key error once per finding for something benign.
    if ((err as { code?: string })?.code === "23503") {
      try {
        await insert(null);
        return;
      } catch (unlinkedErr) {
        console.error(
          "[AI-VERIFY] Could not record 'Mark this result' feedback unlinked either (non-fatal):",
          unlinkedErr instanceof Error ? unlinkedErr.message : unlinkedErr,
        );
        return;
      }
    }
    console.error(
      `[AI-VERIFY] Failed to sync 'Mark this result' feedback for ${findingIds.length} finding(s) (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}

function applyVerdicts(
  findings: Vulnerability[],
  verdictMap: Map<string, Omit<VerifyResult, "id">>,
): Vulnerability[] {
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

/**
 * Whether the verification pass actually happened, for the caller to say so.
 *
 * It used to return void, and the route answered `success: true` either way,
 * so "the AI looked and cleared everything" and "no AI endpoint is configured"
 * and "the provider was down for every chunk" all arrived at the browser as
 * the same green modal reading "AI didn't confirm any findings". On a security
 * tool that is the worst direction for an ambiguity to fall in.
 */
export interface AiVerificationOutcome {
  /** An endpoint resolved at all (instance config, or the user's own key). */
  configured: boolean;
  /** Findings that came back with a verdict. Zero means nothing was judged. */
  verdicts: number;
  /** Findings the pass was asked to judge. */
  attempted: number;
  /**
   * The AI provider refused the pass with a rate limit. The modal says so
   * specifically: "try again in a minute" is the right advice for an outage
   * and the wrong one for a plan limit that resets on the provider's
   * schedule.
   */
  rateLimited?: boolean;
  /**
   * The account's AI allowance and credits covered only part of the pass,
   * which stopped at the first finding they could not pay for. `verdicts`
   * against `attempted` says how far it got.
   */
  budgetExhausted?: boolean;
}

/**
 * Verifies a stored scan's findings and writes the verdicts back onto it.
 * `reservation` is the route's reserveAiTokens gate, as for
 * verifyFindingsBatchWithOutcome: the pass is held to its budget and settles
 * it, on every path out of here.
 */
export async function runAiVerification(
  url: string,
  findings: Vulnerability[],
  scanHistoryId: number,
  userId: number | null,
  reservation: AiTokenReservation | null,
): Promise<AiVerificationOutcome> {
  const spent = { tokens: 0 };
  try {
    if (findings.length === 0) {
      return { configured: true, verdicts: 0, attempted: 0 };
    }

    const endpoint =
      (userId ? await resolveUserEndpoint(userId) : null) ??
      resolveServerEndpoint();

    if (!endpoint) {
      console.error(
        "[AI-VERIFY] No endpoint resolved — check AI_BASE_URL/AI_PROVIDER env vars or user AI config",
      );
      return { configured: false, verdicts: 0, attempted: findings.length };
    }

    const settings = await resolveVerifySettings();
    const probe = await probeTarget(
      url,
      settings.probeTimeoutMs,
      settings.probeBodySnippetChars,
    );
    const deadline = Date.now() + settings.totalTimeoutMs;

    // Verdicts are written to scan_history after every chunk, not just once
    // at the end, so a scan with a lot of findings keeps whatever got
    // verified even if the process is cut off (by the deadline above, or by
    // the calling route's own request timeout) before covering all of them.
    const { verdictMap, rateLimited, budgetExhausted } = await verifyInChunks(
      url,
      findings,
      endpoint,
      probe,
      deadline,
      settings,
      reservation?.budget ?? null,
      spent,
      async (partial) => {
        const enriched = applyVerdicts(findings, partial);
        try {
          await pool.query(
            "UPDATE scan_history SET findings = $1 WHERE id = $2",
            [JSON.stringify(enriched), scanHistoryId],
          );
        } catch (err) {
          console.error(
            "[AI-VERIFY] DB update failed:",
            err instanceof Error ? err.message : err,
          );
        }
        await syncFeedbackFromAiVerdicts(userId, scanHistoryId, url, partial);
      },
    );

    // A pass the budget stopped before its first finding judged nothing
    // because of the account, not the endpoint, so it is not reported as an
    // endpoint failure.
    if (verdictMap.size === 0 && !budgetExhausted) {
      console.error(
        `[AI-VERIFY] All ${findings.length} findings returned null or timed out for ${url} — check the configured AI endpoint/model`,
      );
    }

    return {
      configured: true,
      verdicts: verdictMap.size,
      attempted: findings.length,
      ...(rateLimited ? { rateLimited: true } : {}),
      ...(budgetExhausted ? { budgetExhausted: true } : {}),
    };
  } finally {
    await settleVerifyTokens(reservation, spent.tokens);
  }
}
