/**
 * Check results, and the rules that turn them into a verdict.
 *
 * A check is `required` unless it says otherwise. A required check that does
 * not pass fails its SPIKE item. A check marked `required: false` records an
 * observation the Move should know about (it shows as `warn` when it does not
 * hold) but never decides a verdict.
 */
export function createReport(echo = true) {
  const checks = [];

  return {
    checks,
    /**
     * `fn` returns one of
     *   { ok, detail }   graded
     *   { info }         a recorded fact, not graded
     *   { skip }         does not apply to this target, with the reason
     * and a throw is a failure of that check, not of the run.
     */
    async check(meta, fn) {
      const entry = { required: true, ...meta };
      try {
        const out = await fn();
        if ("skip" in out) {
          entry.status = "skip";
          entry.detail = out.skip;
        } else if ("info" in out) {
          entry.status = "info";
          entry.detail = out.info;
        } else {
          entry.status = out.ok ? "pass" : entry.required ? "fail" : "warn";
          entry.detail = out.detail ?? "";
        }
      } catch (error) {
        entry.status = entry.required ? "fail" : "warn";
        entry.detail = `threw: ${error.message}`;
      }
      checks.push(entry);
      if (echo) {
        const flag = entry.status.toUpperCase().padEnd(4);
        console.log(`  ${flag} ${entry.id} ${entry.title}`);
        if (entry.status === "fail" || entry.status === "warn") {
          console.log(`       ${entry.detail}`);
        }
      }
      return entry;
    },
  };
}

/** Collects what is wrong, so a check can report every problem in one run. */
export function verify() {
  const problems = [];
  return {
    expect(condition, message) {
      if (!condition) problems.push(message);
    },
    problems,
    result(okDetail = "") {
      return problems.length
        ? { ok: false, detail: problems.join("; ") }
        : { ok: true, detail: okDetail };
    },
  };
}

/** The verdict of one SPIKE item on one target. */
export function itemVerdict(checks) {
  const own = checks.filter((c) => c.status !== "info");
  if (!own.length) return "n/a";
  const failed = own.filter((c) => c.status === "fail");
  if (failed.length) return "FAIL";
  const graded = own.filter((c) => c.status === "pass");
  if (!graded.length) return "SKIP";
  return "PASS";
}

export const SPIKE_TITLES = {
  1: "Forwarded request headers reach the handler",
  2: "Params, route precedence and the rewrite origin",
  3: "Bodies, methods, query strings and streams survive",
  4: "Response headers set in middleware reach the client",
  5: "request.url and nextUrl inside the handler and middleware",
  6: "maxDuration of the destination file is honoured",
  7: "Cost of parse and stringify on a 5 MB history/[id]",
};

/**
 * What spec 14.1 decided in advance for each item. Items 2, 3, 5 and 6 have
 * no decided fallback; the text says what the spec says and, where it is
 * silent, what follows from the other fallbacks.
 */
export const FALLBACKS = {
  1: 'Replace the 18 public aliases with thin facade files under app/api/v3 that call versioned("v3", ...) on the real handler (segment config re-declared literally, listed as V3_FACADES), and generate the internal aliases into next.config.mjs rewrites() from the registry. Middleware still decides on the canonical path.',
  2: "No fallback. An origin assertion failure blocks the design (a destination that leaves the request origin makes Next proxy the request with its credentials). A params or precedence failure is not covered by 14.1; the facade-file fallback of item 1 would apply to the affected rows.",
  3: "Not covered by 14.1. A rewrite that buffers or alters a body would move the affected rows to the facade-file fallback of item 1, which has no rewrite in the request path.",
  4: "Set Deprecation, Sunset and Link inside versioned() instead of in middleware.",
  5: "None needed: nothing in the design depends on request.url after a rewrite (the marker is a header), and the compatibility layer already builds no absolute URL.",
  6: "Not covered by 14.1. Re-declare maxDuration literally on the facade files of the item 1 fallback.",
  7: "Give history/[id] and scan/status/[id] a native serialiser that the handler and the adapter both call.",
};
