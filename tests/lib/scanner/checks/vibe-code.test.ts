/**
 * Per-detector tests for the vibe-code category.
 *
 * This category's whole premise is scanning page content for source-code
 * patterns (eval(), SQL string concatenation, hardcoded credential
 * comparisons, etc.) that indicate a real security gap was shipped. None
 * of these detectors restricted their search to genuine <script> content,
 * so a page that merely *documents* one of these patterns as a code
 * example -- a tutorial, a security blog post, or this product's own
 * /docs pages, which render every check's "Bad (AI-generated)" sample as
 * literal <pre>/<code> text -- self-triggered the same detector as a real
 * finding. Fixtures below pin down the fix (stripDocBlocks) and the
 * separate XML-namespace false positive in vibe-http-not-https.
 */

import { detectors } from "@/lib/scanner/checks/vibe-code";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  "vibe-eval-usage": [
    {
      description:
        "a documentation page showing eval() as a 'Bad' code example inside a <pre> block does not fire",
      body: "<script>var x=1;</script><pre>// Bad (AI-generated)\nconst result = eval('(' + serverResponse + ')');</pre>",
      expect: "skip",
    },
    {
      description: "eval() actually present in a live inline script fires",
      body: "<script>const result = eval(userInput);</script>",
      expect: "fire",
      evidenceIncludes: "eval",
    },
  ],
  "vibe-weak-random": [
    {
      description:
        "Math.random() genuinely used to build a security token fires",
      body: "<script>const value = Math.random().toString(36); const kind = 'token';</script>",
      expect: "fire",
      evidenceIncludes: "Math.random()",
    },
    {
      description:
        "Math.random() used for an unrelated DOM element id, with 'productId' appearing much later on the same long minified line, does not fire (bounded proximity window)",
      body:
        "<script>const domId=Math.random().toString(36);" +
        "x".repeat(200) +
        "const productId=42;</script>",
      expect: "skip",
    },
    {
      description:
        "trigger word matches only as a substring of an unrelated identifier ('gridSize') right after Math.random(), not a standalone term -- does not fire",
      body: "<script>const gridSize = Math.random() * 10;</script>",
      expect: "skip",
    },
  ],
  "vibe-sql-string-concat": [
    {
      description:
        "a tutorial's <code> block demonstrating SQL injection as a teaching example does not fire",
      body: "<script>var x=1;</script><code>const query = `SELECT * FROM users WHERE id = ${req.params.id}`;</code>",
      expect: "skip",
    },
  ],
  "vibe-http-not-https": [
    {
      description:
        "inline SVG using the standard http://www.w3.org/2000/svg namespace does not fire",
      body: '<script>var x=1;</script><svg xmlns="http://www.w3.org/2000/svg"></svg>',
      expect: "skip",
    },
    {
      description:
        "JSON-LD structured data using the schema.org context does not fire",
      body: '<script type="application/ld+json">{"@context":"http://schema.org","@type":"Product"}</script>',
      expect: "skip",
    },
    {
      description: "a genuine hardcoded http:// API endpoint still fires",
      body: "<script>const apiUrl = 'http://api.internal-service.com/v1';</script>",
      expect: "fire",
      evidenceIncludes: "http://",
    },
  ],
  "vibe-generic-error-message": [
    {
      description:
        "an SSR-framework i18n/state JSON blob containing a generic error string as data does not fire",
      body: '<script>window.__i18n = {"errors":{"generic":"Something went wrong"}};</script>',
      expect: "skip",
    },
    {
      description:
        "a generic error string used as an alert() inside a real .catch() handler fires",
      body: '<script>fetch(url).catch(function(e){ alert("Something went wrong"); });</script>',
      expect: "fire",
      evidenceIncludes: "exception-handling",
    },
  ],
  "vibe-weak-password-policy": [
    {
      description:
        "regression: a login form's password field (autocomplete=current-password) does not fire -- 'strength' has no meaning for verifying an existing password, fired on VulnRadar's own /login",
      body: '<script></script><input type="password" autocomplete="current-password">',
      expect: "skip",
    },
    {
      description:
        "a signup field (autocomplete=new-password) with no visible validation fires",
      body: '<script></script><input type="password" autocomplete="new-password">',
      expect: "fire",
      evidenceIncludes: "strength validation",
    },
    {
      description:
        "a signup field with a visible minLength check does not fire",
      body: '<script>if (password.length < 12) return;</script><input type="password" autocomplete="new-password">',
      expect: "skip",
    },
  ],
  "vibe-password-in-comment": [
    {
      description: "an ordinary password-validation-rule comment does not fire",
      body: "<script>// password: minimum 8 characters, 1 uppercase, 1 number\nfunction validate(){}</script>",
      expect: "skip",
    },
    {
      description: "a commented-out literal credential still fires",
      body: "<script>// password: hunter2\nconst legacyLogin = true;</script>",
      expect: "fire",
      evidenceIncludes: "credential",
    },
  ],
};

runDetectorTests(detectors, fixtures);
