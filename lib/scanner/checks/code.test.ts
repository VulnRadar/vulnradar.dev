/**
 * Per-detector tests for the code category.
 *
 * Covers 154 detectors in lib/scanner/checks/code.ts. Every detector
 * is exercised by the smoke harness (callable, no-throw, deterministic);
 * a small number of detectors with simple enough patterns also get
 * explicit positive fixtures.
 *
 * Most code detectors look for specific JS patterns in `<script>`
 * blocks; the fixtures below use straightforward patterns that the
 * detector regexes match directly. Detectors with very narrow patterns
 * (e.g. requiring ≥2 occurrences of a sink) are smoke-only.
 */

import { detectors } from "./code";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  "outerhtml-xss-sink": [
    {
      description: "outerHTML assignment",
      body: "<html><body><script>document.body.outerHTML = '<div>' + name + '</div>';</script></body></html>",
      expect: "fire",
    },
  ],

  "document-write-sink": [
    {
      description: "document.write call",
      body: "<html><body><script>document.write('<h1>' + title + '</h1>');</script></body></html>",
      expect: "fire",
    },
  ],

  "insertadjacenthtml-sink": [
    {
      description: "insertAdjacentHTML call",
      body: "<html><body><script>el.insertAdjacentHTML('beforeend', html);</script></body></html>",
      expect: "fire",
    },
  ],

  "unsafe-setattribute": [
    {
      description: "setAttribute with on-handler",
      body: "<html><body><script>el.setAttribute('onclick', 'do(' + x + ')');</script></body></html>",
      expect: "fire",
    },
  ],

  "eval-usage": [
    {
      description: "eval() call",
      body: "<html><body><script>eval(userInput);</script></body></html>",
      expect: "fire",
    },
  ],

  "function-constructor": [
    {
      description: "new Function() constructor",
      body: "<html><body><script>const fn = new Function('a', 'b', code);</script></body></html>",
      expect: "fire",
    },
  ],

  "settimeout-string": [
    {
      description: "setTimeout with string arg",
      body: "<html><body><script>setTimeout('alert(1)', 100);</script></body></html>",
      expect: "fire",
    },
  ],

  "localstorage-sensitive": [
    {
      description: "localStorage with token",
      body: "<html><body><script>localStorage.setItem('token', authToken);</script></body></html>",
      expect: "fire",
    },
  ],

  "code-fetch-no-timeout": [
    {
      description: "fetch without AbortController/timeout",
      body: "<html><body><script>fetch('/api/users').then(r => r.json());</script></body></html>",
      expect: "fire",
    },
  ],

  "code-timing-no-constant-time-compare": [
    {
      description: "timing-vulnerable string compare",
      body: "<html><body><script>if (token === stored) { allow = true; }</script></body></html>",
      expect: "fire",
    },
  ],
};

runDetectorTests(detectors, fixtures);
