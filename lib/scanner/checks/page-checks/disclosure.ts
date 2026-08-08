/**
 * Verbose error and internal-path disclosure.
 *
 * The engine audit flagged `stack-trace-exposed` as a written detector with
 * no JSON definition (an orphan, unreachable under any ID) and named
 * verbose error pages as a real coverage gap: the `code`, `secrets-extended`
 * and `information-disclosure` categories combined produced zero findings
 * on the audit's fixtures. These checks are new, narrowly-scoped detections
 * against known error/debug page shapes, matched against `ctx.text`
 * (script/style/comment-stripped visible text) or the raw body where a
 * debug page's own markup is the signal.
 */

import type { PageCheck } from "../../check-types";
import { excerpt } from "../../check-types";

const STACK_TRACE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Node.js/V8", re: /at\s+[\w$.<>]+\s+\([^)]*\.(?:js|ts):\d+:\d+\)/ },
  { name: "Python", re: /Traceback \(most recent call last\):/ },
  {
    name: "PHP",
    re: /(?:Fatal error|Warning|Notice):.{0,200}?\bin\s+\S+\.php(?:\s+on line\s+\d+| on line \d+)/is,
  },
  { name: "Java", re: /at\s+[\w.$]+\([\w.]+\.java:\d+\)/ },
  { name: ".NET", re: /System\.[\w.]*Exception:[^\n]*\n\s*at\s+[\w.]+/ },
];

const DEBUG_MODE_MARKERS: { name: string; re: RegExp; critical?: boolean }[] = [
  {
    name: "Django",
    re: /You're seeing this error because you have <code>DEBUG = True<\/code>|DisallowedHost at \/|Django Version:\s*\d/,
  },
  {
    name: "Laravel",
    re: /Whoops,?\\?\s*looks like something went wrong|"exception":"Illuminate\\\\|Illuminate\\\\Foundation\\\\Application/,
  },
  {
    name: "Ruby on Rails",
    re: /ActionController::RoutingError|app\/(?:controllers|models)\/[\w_]+\.rb:\d+:in/,
  },
  {
    name: "Flask/Werkzeug",
    re: /Werkzeug Debugger|The debugger caught an exception in your WSGI application/,
    critical: true,
  },
  {
    name: "ASP.NET",
    re: /Server Error in '\/' Application|A potentially dangerous Request\.(?:Form|QueryString) value was detected/,
  },
];

const INTERNAL_PATH_PATTERNS: RegExp[] = [
  /[A-Za-z]:\\(?:Users|inetpub|Windows|Program Files(?: \(x86\))?)\\[\w \\.-]+/,
  /\/(?:home|Users)\/[\w.-]+\/[\w./-]*\.(?:js|ts|php|py|rb|java|log)\b/,
  /\/var\/(?:www|log|lib)\/[\w./-]+/,
  /\/usr\/local\/[\w./-]+/,
  /\/opt\/[\w./-]+\/[\w./-]+/,
];

export const disclosureChecks: PageCheck[] = [
  {
    id: "page-stack-trace-disclosed",
    title: "Application stack trace or interpreter error disclosed in response",
    category: "information-disclosure",
    severity: "medium",
    method: "body-pattern",
    confidence: 68,
    description:
      "The response body contains what looks like an unhandled application error or stack trace rather than a user-facing error page.",
    riskImpact:
      "Stack traces reveal internal file paths, function and class names, and sometimes library versions or query fragments, all of which shorten the work needed to find a way in.",
    explanation:
      "Matched against known stack-trace and interpreter-error formats (Node.js, Python, PHP, Java, .NET). A page that discusses error handling in prose could coincidentally match one of these formats; verify the matched excerpt is a real error before treating this as confirmed.",
    fixSteps: [
      "Disable detailed/debug error output in the production environment configuration.",
      "Return a generic error page to users and log the full trace server-side only.",
    ],
    codeExamples: [],
    needs: ["body"],
    run(ctx) {
      const haystack = ctx.text + "\n" + ctx.comments.join("\n");
      for (const { name, re } of STACK_TRACE_PATTERNS) {
        const m = haystack.match(re);
        if (m) {
          return {
            evidence: `A ${name}-style stack trace or interpreter error appears in the response.`,
            excerpts: [excerpt("stack trace", m[0])],
          };
        }
      }
      return null;
    },
  },

  {
    id: "page-debug-mode-enabled",
    title: "Framework debug or development error page exposed",
    category: "information-disclosure",
    severity: "high",
    method: "body-pattern",
    confidence: 72,
    description:
      "The response matches a known framework's debug-mode error page rather than a production error page.",
    riskImpact:
      "Debug error pages typically include the full stack trace, the offending source line, local variable values, and environment configuration; Werkzeug's interactive debugger in particular allows arbitrary code execution from the browser if reachable.",
    explanation:
      "Matched against known debug-page markers for Django, Laravel, Rails, Flask/Werkzeug, and ASP.NET. This confirms the page's shape, not that every request shows it: a scan only sees the one response fetched.",
    fixSteps: [
      "Set the framework's debug flag to false in production (DEBUG=False for Django, APP_DEBUG=false for Laravel, config.consider_all_requests_local = false for Rails).",
      "Confirm the Werkzeug interactive debugger is disabled or PIN-protected in any environment reachable from the internet.",
    ],
    codeExamples: [],
    needs: ["body"],
    run(ctx) {
      for (const { name, re, critical } of DEBUG_MODE_MARKERS) {
        const m = ctx.body.match(re);
        if (m) {
          return {
            evidence: `Response matches ${name}'s debug/development error page.`,
            excerpts: [excerpt("debug page marker", m[0])],
            severity: critical ? "critical" : "high",
          };
        }
      }
      return null;
    },
  },

  {
    id: "page-internal-path-disclosed",
    title: "Internal filesystem path disclosed in response",
    category: "information-disclosure",
    severity: "low",
    method: "body-pattern",
    confidence: 55,
    description:
      "The response body contains what looks like an absolute filesystem path from the server or a developer's machine.",
    riskImpact:
      "Internal paths reveal the server's operating system, directory layout, and deployment user, and sometimes a developer's local username, all of which help target further probing.",
    explanation:
      "Matched against common absolute-path shapes for Windows, Linux home directories, and standard *nix service paths. A documentation page showing an example file path as instructional text can trigger this; check the excerpt before treating it as a real leak.",
    fixSteps: [
      "Disable verbose error output that echoes filesystem paths in production.",
      "If the path appears in a comment or example, confirm it is intentional documentation rather than a leftover debug artifact.",
    ],
    codeExamples: [],
    needs: ["body"],
    run(ctx) {
      for (const re of INTERNAL_PATH_PATTERNS) {
        const m = ctx.body.match(re);
        if (m) {
          return {
            evidence: "An absolute filesystem path is present in the response.",
            excerpts: [excerpt("path", m[0])],
          };
        }
      }
      return null;
    },
  },
];
