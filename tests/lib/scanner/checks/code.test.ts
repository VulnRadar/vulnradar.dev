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

import { detectors } from "@/lib/scanner/checks/code";
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
      description:
        "eval() — covered by eval-in-scripts; removed to reduce noise from minified bundles",
      body: "<html><body><script>eval(userInput);</script></body></html>",
      expect: "skip",
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
      description:
        "covered by code-eval-setinterval-string; removed to avoid duplicate",
      body: "<html><body><script>setTimeout('alert(1)', 100);</script></body></html>",
      expect: "skip",
    },
  ],

  "localstorage-sensitive": [
    {
      description: "localStorage with token",
      body: "<html><body><script>localStorage.setItem('token', authToken);</script></body></html>",
      expect: "fire",
    },
  ],

  "code-timing-no-constant-time-compare": [
    {
      description:
        "detector disabled (100% false positive rate on client-side JS)",
      body: "<html><body><script>if (token === stored) { allow = true; }</script></body></html>",
      expect: "skip",
    },
  ],

  // ── hardcoded-secrets severity tiers ──────────────────────────────────
  //
  // Split by whether the credential format has a legitimate reason to be
  // client-visible (see lib/scanner/checks/code.ts for the full pattern
  // lists and reasoning per tier). The AWS-key case pins the critical tier
  // still fires for genuine server-only secrets; the Google-API-key case
  // is the regression test for the bug that motivated the split — a
  // scan of walmart.com matched Google API keys via this check's old flat
  // "critical" severity, which alone was enough to mark the whole scan
  // "unsafe" even though Google API keys are designed to be client-visible
  // and are already covered at "medium" by google-api-key-exposed
  // (content.json) and secret-google-maps-api-key (secrets-extended.json).
  "hardcoded-secrets": [
    {
      description:
        "AWS access key — genuine server-only secret, stays critical",
      body: "<script>const key = 'AKIAABCDEFGHIJKLMNOP';</script>",
      expect: "fire",
      evidenceIncludes: "AWS Access Key",
    },
    {
      description:
        "Google API key ALONE must not fire here — no legitimate-secret pattern present, and the format is covered by google-api-key-exposed / secret-google-maps-api-key at medium severity instead of being re-flagged critical",
      body: "<script>const mapsKey = 'AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe';</script>",
      expect: "skip",
    },
  ],

  "hardcoded-secrets-high-risk": [
    {
      description:
        "HuggingFace write token — real secret, but blast radius is one vendor account, not full infra (high, not critical)",
      body: "<script>const t = 'hf_1234567890abcdefghijklmnopqrstuvwxyzAB';</script>",
      expect: "fire",
      evidenceIncludes: "HuggingFace Token",
    },
    {
      description: "clean page has nothing to flag",
      body: "<html><body><p>Nothing sensitive here.</p></body></html>",
      expect: "skip",
    },
  ],

  "hardcoded-secrets-client-exposed": [
    {
      description:
        "Mapbox public token (pk. prefix is Mapbox's own client-safe convention) — medium, matches this codebase's Google-key precedent",
      body: "<script>mapboxgl.accessToken = 'pk.eyJhbGciOiJIUzI1NiJ9.aBcDeFgHiJkLmN123';</script>",
      expect: "fire",
      evidenceIncludes: "Mapbox Public Token",
    },
    {
      description: "clean page has nothing to flag",
      body: "<html><body><p>Nothing sensitive here.</p></body></html>",
      expect: "skip",
    },
  ],

  "hardcoded-secrets-low-risk": [
    {
      description:
        "Firebase Realtime Database URL is a hostname, not a credential — informational (low)",
      body: "<script>const db = 'https://my-app-prod.firebaseio.com';</script>",
      expect: "fire",
      evidenceIncludes: "Firebase Database URL",
    },
    {
      description: "clean page has nothing to flag",
      body: "<html><body><p>Nothing sensitive here.</p></body></html>",
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
