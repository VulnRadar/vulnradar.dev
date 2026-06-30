---
name: Scanner Detector Proposal
description: Propose a new detection check for the VulnRadar scanner engine.
title: "[Detector]: "
labels: ["scanner", "enhancement", "needs-triage"]
assignees: []
---

# Scanner Detector Proposal

## What should the scanner catch?

## Threat model

- Attacker:
- Target:
- Preconditions:
- Impact:

## Real-world example

- CVE / writeup: (e.g. CVE-2024-XXXX, https://...)
- Vulnerable code example:
  ```js
  // paste a realistic bad pattern
  ```

## Detection strategy

- Response component: [ ] headers [ ] body [ ] status [ ] async probe
- Detection type:
  - [ ] body-pattern (regex against response body)
  - [ ] header-pattern (regex against response headers)
  - [ ] status-based (fires on specific status codes)
  - [ ] protocol-specific (TLS, DNS, etc.)
  - [ ] async (out-of-band probe)
- Pattern (if regex): `...`
- Severity: [ ] critical [ ] high [ ] medium [ ] low [ ] info
- Category: [ ] headers [ ] content [ ] cookies [ ] config [ ] info-disclosure
  [ ] dns [ ] email [ ] api [ ] code [ ] secrets [ ] ssl [ ] tls

## False-positive risk

- Common cases that would match:
- Suggested exclusion:

## Test fixtures

- Positive: https://example.com/... (what to match)
- Negative: https://example.com/... (what NOT to match)

## Reference

- CWE:
- OWASP:
- RFC / spec:

## Implementation

- Detection file: lib/scanner/checks/<category>.ts
- JSON definition: lib/scanner/checks-data/<category>.json
- Test fixture: lib/scanner/checks/<category>.test.ts

## Willing to help

- [ ] I can submit a PR with the implementation
- [ ] I can add the JSON entry
- [ ] I can add the test fixtures
- [ ] Just the idea
