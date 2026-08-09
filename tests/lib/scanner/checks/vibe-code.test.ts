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
};

runDetectorTests(detectors, fixtures);
