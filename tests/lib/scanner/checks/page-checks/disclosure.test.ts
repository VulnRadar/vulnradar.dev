import { describe } from "vitest";
import { disclosureChecks } from "@/lib/scanner/checks/page-checks/disclosure";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-stack-trace-disclosed": [
    {
      description: "Node.js/V8 stack trace",
      body: `<pre>Error: boom\n    at Object.exports.run (/app/index.js:12:34)</pre>`,
      expect: "fire",
    },
    {
      description: "Python traceback",
      body: `<pre>Traceback (most recent call last):\n  File "app.py", line 3</pre>`,
      expect: "fire",
      evidenceIncludes: "python",
    },
    {
      description: "PHP fatal error with file path and line number",
      body: `<pre>Fatal error: Uncaught Error: Call to undefined function foo() in /var/www/html/index.php on line 42</pre>`,
      expect: "fire",
      evidenceIncludes: "php",
    },
    {
      description: "ordinary page with no error content",
      body: `<html><body><h1>Welcome</h1></body></html>`,
      expect: "skip",
    },
  ],
  "page-debug-mode-enabled": [
    {
      description: "Django DEBUG=True error page",
      body: `<p>You're seeing this error because you have <code>DEBUG = True</code> in your settings file.</p>`,
      expect: "fire",
      evidenceIncludes: "django",
    },
    {
      description: "Werkzeug interactive debugger",
      body: `<title>Werkzeug Debugger</title>`,
      expect: "fire",
      evidenceIncludes: "flask",
    },
    {
      description: "Rails routing error page",
      body: `<pre>ActionController::RoutingError (No route matches [GET] "/x"):</pre>`,
      expect: "fire",
    },
    {
      description: "ordinary production page",
      body: `<html><body><h1>Welcome</h1></body></html>`,
      expect: "skip",
    },
  ],
  "page-internal-path-disclosed": [
    {
      description: "Windows path under Users",
      body: `<pre>C:\\Users\\devuser\\project\\app.js:12</pre>`,
      expect: "fire",
    },
    {
      description: "Linux path under /var/www",
      body: `<pre>include(/var/www/html/config.php): failed to open stream</pre>`,
      expect: "fire",
    },
    {
      description: "Linux home directory path with a source extension",
      body: `<pre>/home/deploy/app/server.js:88</pre>`,
      expect: "fire",
    },
    {
      description: "ordinary page with no filesystem paths",
      body: `<html><body><h1>Welcome</h1></body></html>`,
      expect: "skip",
    },
  ],
};

describe("page-checks/disclosure", () => {
  runPageCheckTests(disclosureChecks, fixtures);
});
