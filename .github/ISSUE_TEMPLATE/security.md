name: Security Report
description: Report a security vulnerability in VulnRadar (the scanner / app, not a scanned target).
title: "[Security]: "
labels: ["security", "needs-triage"]
assignees: ["RejectModders"]
---

# Security Report

> **Please do NOT open a public issue for security vulnerabilities.**
> Email security@vulnradar.dev (PGP key in /.well-known/security.txt)
> for a private disclosure. This template is for low-severity findings
> or for things you can fully describe publicly.

## Summary

## Affected component

- Component / file:
- VulnRadar version (or commit SHA):
- Self-hosted or hosted?

## Severity

- [ ] Critical — production is exploitable right now
- [ ] High — meaningful attack surface exposed
- [ ] Medium — bounded impact
- [ ] Low — defense-in-depth
- [ ] Informational

## Attack scenario

- step 1
- step 2
- step 3

## Reproduction

```bash
# commands
```

## Impact

- [ ] Account takeover
- [ ] Data exposure (specify: PII, scan results, API keys, ...)
- [ ] RCE / file read
- [ ] SSRF / outbound network
- [ ] DoS
- [ ] Privilege escalation
- [ ] Other:

## Suggested fix (optional)

## Disclosure preferences

- [ ] OK to credit me in the public changelog
- [ ] Keep my name out of the public report
- [ ] Want coordinated disclosure (90-day window)
- [ ] Want a private CVE assignment
- [ ] Already disclosed publicly at: [link]
