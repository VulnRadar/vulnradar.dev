# Scanner Learning System

## Overview

VulnRadar's scanner learning system allows the engine to improve over time based on user feedback. When users mark findings as false positives, confirmed vulnerabilities, or not applicable, those signals are stored and used to adaptively adjust confidence scoring.

## How It Works

### 1. Feedback Collection

Users can submit feedback on individual findings via:

```
POST /api/v3/scan/feedback
{
  "findingId": "hsts-missing",
  "findingUrl": "https://example.com",
  "scanHistoryId": 1234,
  "verdict": "false_positive" | "confirmed" | "not_applicable",
  "notes": "Optional explanation"
}
```

Feedback is stored in `scan_finding_feedback` and upserted (one verdict per user+finding+URL combination).

### 2. Confidence Levels in Check Definitions

Each check definition in JSON can include an optional `confidence` field:

```json
{
  "id": "vibe-math-random-token",
  "confidence": "low",
  "...": "..."
}
```

**Values:**

- `"high"`: Near-zero false positive rate. Deterministic header/cookie checks. (e.g., `hsts-missing`)
- `"medium"`: Pattern-based, ~10-20% FP rate. Body regex patterns with context. (e.g., `vibe-todo-security-comment`)
- `"low"`: Heuristic, 30%+ FP rate. Structural/behavioral inference. (e.g., `idor-sequential-id-in-url`)

When not specified, confidence defaults based on the check `type`:

- `header-missing` / `header-present` → 97 (high)
- `header-value` → 90
- `combined` → 85
- `url-check` → 82
- `body-pattern` → 70
- default → 55

### 3. Adaptive Confidence (Future)

The learning system is designed for a future adaptive confidence step:

1. **Aggregate feedback**: Query `scan_finding_feedback` grouped by `finding_id` to compute false-positive rates per check.
2. **Degrade confidence**: When a check's FP rate exceeds 30% (across N users), reduce its effective confidence score.
3. **Domain-scoped suppression**: When a specific `(finding_id, domain)` pair accumulates 3+ false-positive verdicts from the same user, auto-suppress that check for that domain in future scans.
4. **Global suppression**: If a check has >50% FP rate across all users globally, flag it for review and demote severity.

**Implementation sketch:**

```typescript
// lib/scanner/adaptive-confidence.ts
export async function getAdaptiveConfidence(
  checkId: string,
  domain: string,
  userId: number,
): Promise<number | null> {
  const result = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE verdict = 'false_positive') AS fp_count,
      COUNT(*) FILTER (WHERE verdict = 'confirmed') AS confirmed_count,
      COUNT(*) AS total
    FROM scan_finding_feedback
    WHERE finding_id = $1
      AND finding_url LIKE $2
      AND user_id = $3
  `,
    [checkId, `%${domain}%`, userId],
  );

  const { fp_count, total } = result.rows[0];
  if (total < 3) return null; // Not enough signal
  const fpRate = fp_count / total;
  if (fpRate > 0.7) return 0; // Auto-suppress
  if (fpRate > 0.5) return 30; // Very low confidence
  if (fpRate > 0.3) return 50; // Degraded confidence
  return null; // Use default
}
```

### 4. Adding New Checks (Modular Architecture)

The scanner is designed so adding a new category requires only three steps:

1. **Create** `lib/scanner/checks-data/<category>.json`: array of CheckDef objects
2. **Create** `lib/scanner/checks/<category>.ts`: `export const detectors: Record<string, EvidenceFn>`
3. **Register** in `lib/scanner/registry.ts`: add import + one entry in BUNDLES

No other files need to change. The type system, scan orchestrator, and docs page all read from the registry dynamically.

**CheckDef schema:**

```json
{
  "id": "unique-kebab-case-id",
  "type": "body-pattern | header-missing | header-present | header-value | combined | url-check",
  "title": "Human-readable title",
  "category": "one-of-the-Category-union-values",
  "severity": "critical | high | medium | low | info",
  "confidence": "high | medium | low",
  "description": "What this check detects and why it matters.",
  "evidence": "Template for the evidence string shown in findings.",
  "riskImpact": "What an attacker can do if this finding is real.",
  "explanation": "Technical explanation of the vulnerability.",
  "fixSteps": ["Step 1", "Step 2", "Step 3"],
  "codeExamples": [
    { "label": "Example label", "language": "typescript", "code": "..." }
  ],
  "references": ["https://..."]
}
```

**Before adding checks, always run:**

```bash
node scripts/find-duplicate-ids.mjs
```

### 5. Current Check Counts

| Category               | Count | Coverage        |
| ---------------------- | ----- | --------------- |
| headers                | ~123  | Excellent       |
| content                | ~137  | Excellent       |
| code                   | ~112  | Excellent       |
| secrets-extended       | ~51   | Good            |
| api                    | ~32   | Good            |
| cookies                | ~24   | Good            |
| tls                    | ~20   | Good            |
| information-disclosure | ~34   | OK              |
| email                  | ~18   | OK              |
| dns                    | ~13   | OK              |
| configuration          | ~18   | OK              |
| ssl                    | ~8    | Needs expansion |
| vibe-code              | ~30   | New             |
| client-side            | ~16   | New             |
| supply-chain           | ~8    | New             |
| host-validation        | ~7    | New             |

**Total target: 800+ checks**

### 6. False Positive Prevention

High-confidence checks (header-missing, header-present) should have near-zero FP rates: the finding is deterministic.

Body-pattern checks need special care:

- Strip `<code>`, `<pre>`, `<script>` blocks from documentation/example content before pattern matching
- Use context-aware patterns: require surrounding terms that confirm security relevance
- Set appropriate confidence levels in the JSON definition
- Test patterns against Alexa top-1000 sites mentally: would this fire on common legitimate sites?

### 7. Feedback API

```
POST /api/v3/scan/feedback   -- Submit a verdict on a finding
GET  /api/v3/scan/feedback   -- Retrieve your feedback (optional ?url=&findingId=)
```

Both endpoints require authentication. The GET endpoint is useful for the UI to pre-populate feedback UI state when a user revisits a scan.
