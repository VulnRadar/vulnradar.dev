# VulnRadar Changelog — AI Knowledge

_Auto-compiled from `app/changelog/page.tsx` on 2026-06-30._

This file is consumed by the AI system prompt at runtime so the
assistant can answer questions about specific versions, release
dates, and shipped features. When a user asks "what changed in
v2.3.0?" or "when was the API keys feature added?", answer from
this file. The current/latest version is always the first entry.

Versioning: major.minor.patch. The engine version (scanner rules)
and the app version (UI/backend) are tracked separately in the
config (see `lib/config/config-values.ts`).

---

## v3.0.0 — June 25, 2026 **(highlights)**
**Simpler Scanner UX, Service Probes by Hostname, Detection Engine v3**

Major UX rewrite of the scanner. Drop the protocol dropdown — just type a domain. Service probes (SSH, SMTP, IMAP, POP3, FTP, MongoDB) are togglable on the right with per-probe port inputs. Detection Engine bumped to v3.0.0 with cleaner category coverage. URL state for /dashboard is query-param driven (mode, probes). API: send probes: ["ssh:22", "smtp:587"] in the scan request body.

## v2.3.1 — June 20, 2026
**Tooling Hardening, Node 22 LTS, Schema Version Gate**

Stability release. Splits the monolithic db scripts into a version-aware framework (scripts/_lib + scripts/migrate + scripts/create-fresh-db), adds a startup-time schema version gate so apps running against a stale database refuse to boot with a clear red error box, pins the project to Node 22 LTS, and bumps 75 npm packages to their latest within-major versions. No app-facing feature changes; no DB schema changes (2.3.0 and 2.3.1 share the same DDL).

## v2.3.0 — June 20, 2026 **(highlights)**
**Comprehensive Security Patch & Quality Update**

Security-patch release built on a full source audit. Closes every critical and high-severity finding across auth, crypto, sessions, rate-limiting, file uploads, webhooks, and access control; hardens the build/CI pipeline so typecheck and dependency-audit failures block merges; introduces per-route error boundaries, accessible forms, and a complete vitest test suite covering the security-critical code paths. Internals consolidated: single source of truth for constants, plans/products, scanner helpers, and admin role checks; duplicate code paths removed across ~10 admin route files.

## v2.2.3 — April 9, 2026 **(highlights)**
**HTTPS Scanning Fix & Security Stabilization**

Critical fix for HTTPS scanning failures caused by SSL/TLS certificate validation issues introduced in 2.2.2 security hardening. Resolved issue where resolved IPs were used for all protocols, breaking certificate validation for HTTPS URLs. Enhanced configuration system and middleware stability with comprehensive code quality improvements.

### Changes
- [icon] **(unlabelled)**

## v2.2.2 — April 7, 2026
**Security Hardening & Code Quality Improvements**

Comprehensive security fixes addressing SSRF vulnerabilities across all scan endpoints, enhanced DNS rebinding prevention, dependency updates to latest versions, and extensive code quality improvements. Improved error logging for webhooks and email notifications.

### Changes
- [icon] **(unlabelled)**

## v2.2.1 — April 5, 2026
**Broadcast Messaging Hotfix**

Fixed database schema mismatch in broadcast messaging system that prevented admin broadcasts from being sent.

### Changes
- [icon] **(unlabelled)**

## v2.2.0 — March 31, 2026 **(highlights)**
**Backend Optimization, API Enhancements & Security Hardening**

Comprehensive backend optimization and API improvements with enhanced performance. Improved UI responsiveness and visual consistency across the platform. Critical security vulnerabilities patched including SSRF prevention, enhanced password hashing, and comprehensive input validation.

### Changes
- [icon] **(unlabelled)**

## v2.1.2 — March 27, 2026
**Admin Panel UX Improvements, Gift Subscriptions & Support Role Fixes**

Major improvements to the admin panel user management including gift subscription system with plan/duration selection, fixed modal z-index issues causing header disappearance, proper support role badge coloring, and streamlined user list actions.

## v2.1.1 — March 23, 2026 **(highlights)**
**Profile UI Redesign, Email Notifications for Scans & API Key Security Enhancement**

Complete overhaul of the Settings/Profile page with modern sidebar navigation, consistent spacing, and unified icon styling. Added email notifications for scan completions and critical findings. Enhanced API key security by permanently deleting old keys on rotation instead of archiving them.

### Changes
- [icon] **(unlabelled)**

## v2.1.0 — March 21, 2026 **(highlights)**
**Complete UI/UX Redesign, Support Actions System & Admin Dashboard Overhaul**

Comprehensive redesign of all user-facing pages with modern design patterns. New support action confirmation system with email notifications, fixed staff role detection for unlimited access, and complete admin panel modernization. All sorting functionality restored and working correctly.

## v2.0.5 — March 16, 2026 **(highlights)**
**API Rate Limiting Complete & Enhanced Legal Documentation**

Comprehensive API rate limiting implementation across all documented endpoints with proper daily limit tracking, source tracking fixes for crawl/bulk operations, DELETE endpoint implementation, and enhanced accessibility documentation.

## v2.0.4 — March 16, 2026 **(highlights)**
**Comprehensive Legal Overhaul & API Route Authentication Fix**

Major update to all legal documents for full Missouri/US compliance including CCPA/CPRA, state privacy laws, and GDPR. Fixed API key authentication across all v2 endpoints and added terms re-acceptance system for returning users.

## v2.0.3 — March 15, 2026
**310+ Security Checks, Config System Overhaul & UI Improvements**

Massive expansion of the detection engine to 310+ checks, complete configuration system overhaul eliminating environment variable complexity, and important UI fixes for better cross-platform support.

### Changes
- [icon] **(unlabelled)**

## v2.0.2 — March 14, 2026 **(highlights)**
**Badge page 500 error fixed**

### Changes
- [icon] **(unlabelled)**

## v2.0.1 — March 14, 2026
**Detection Engine v2.0.1, Subdomain Caching & Share Modal**

Major detection engine improvements to reduce false positives, new subdomain caching system, and a beautiful custom share modal for scan results.

### Changes
- [icon] **(unlabelled)**

## v2.0.0 — March 12, 2026
**Stripe Billing, Discord Integration, Admin Notifications & Design System Overhaul**

The biggest release yet with full Stripe billing integration, Discord account linking, comprehensive admin notification system, and a complete design system overhaul.

### Changes
- [icon] **(unlabelled)**

## v1.9.5-patch.1 — March 9, 2026
**API v1 routes fixed**

### Changes
- [icon] **(unlabelled)**

## v1.9.5 — March 7, 2026
**API v1 Versioning, Developer SDK Support & Finding Types Endpoint**

### Changes
- [icon] **(unlabelled)**

## v1.9.4-patch.1 — February 28, 2026
**API Key Encryption Fix, Stronger Key Entropy & Validation Overhaul**

### Changes
- [icon] **(unlabelled)**

## v1.9.4 — February 26, 2026
**UI Consistency, Docker Build-Time Vars, Discord Giveaway & Encryption-First API Keys**

### Changes
- [icon] **(unlabelled)**

## v1.9.3 — February 24, 2026
**Admin Version Monitoring & Enhanced Admin Controls**

### Changes
- [icon] **(unlabelled)**

## v1.9.2 — February 24, 2026
**Security Hardening, GDPR Compliance & Docker Production Overhaul**

### Changes
- [icon] **(unlabelled)**

## v1.9.1 — February 23, 2026
**ToS Modal & Header Fixes**

### Changes
- [icon] **(unlabelled)**

## v1.9.0 — February 23, 2026
**Auth-Aware Public Pages, Codebase Refactor & Performance**

### Changes
- [icon] **(unlabelled)**

## v1.8.0 — February 21, 2026
**Email 2FA, Expanded Notifications & 55+ New Security Checks**

### Changes
- [icon] **(unlabelled)**

## v1.7.4 — February 19, 2026
**Docker Production Ready, Mobile UX Overhaul & Error Pages**

### Changes
- [icon] **(unlabelled)**

## v1.7.3 — February 19, 2026
**Unified Footer, Contact Upgrades & Error Pages**

### Changes
- [icon] **(unlabelled)**

## v1.7.2 — February 19, 2026
**Self-Hosted Schema & Stability Fixes**

### Changes
- [icon] **(unlabelled)**

## v1.7.1 — February 19, 2026
**Migration Tool Improvements & Documentation Overhaul**

### Changes
- [icon] **(unlabelled)**

## v1.7.0 — February 18, 2026
**Deep Crawl URL Selector, IP Rate-Limited Demo & Auto Scan Notes**

### Changes
- [icon] **(unlabelled)**

## v1.6.8 — February 16, 2026
**Metadata & Social Preview Fixes**

### Changes
- [icon] **(unlabelled)**

## v1.6.7 — February 16, 2026
**Scan Notes Visibility & Team Collaboration**

### Changes
- [icon] **(unlabelled)**

## v1.6.6 — February 15, 2026
**Subdomain Discovery Depth & Deep Scan Prefix**

### Changes
- [icon] **(unlabelled)**

## v1.6.5 — February 15, 2026
**Scan Depth & Performance Improvements**

### Changes
- [icon] **(unlabelled)**

## v1.6.4 — February 14, 2026
**Subdomain Discovery & Real-Time Progress**

### Changes
- [icon] **(unlabelled)**

## v1.6.3 — February 14, 2026
**Scanner Category Visualization**

### Changes
- [icon] **(unlabelled)**

## v1.6.2 — February 13, 2026
**Expanded Security Coverage**

### Changes
- [icon] **(unlabelled)**

## v1.6.1 — February 12, 2026
**Export & Sharing Enhancements**

### Changes
- [icon] **(unlabelled)**

## v1.6.0 — February 11, 2026
**Deep Crawl Scanning**

### Changes
- [icon] **(unlabelled)**

## v1.5.0 — February 10, 2026
**Scheduled Scanning & Bulk Operations**

### Changes
- [icon] **(unlabelled)**

## v1.4.0 — February 10, 2026
**Team Collaboration**

### Changes
- [icon] **(unlabelled)**

## v1.3.0 — February 9, 2026
**API Access & Webhooks**

### Changes
- [icon] **(unlabelled)**

## v1.2.0 — February 9, 2026
**Comparison & History**

### Changes
- [icon] **(unlabelled)**

## v1.1.2 — February 9, 2026
**Safety Rating Indicator**

### Changes
- [icon] **(unlabelled)**

## v1.1.1 — February 9, 2026
**Metadata & Branding Polish**

### Changes
- [icon] **(unlabelled)**

## v1.1.0 — February 9, 2026
**Contact System & UI Enhancements**

### Changes
- [icon] **(unlabelled)**

## v1.0.0 — February 8, 2026
**First Release**

### Changes
- [icon] **(unlabelled)**

---

## Quick reference

- **Total releases:** 47
- **Latest:** v3.0.0 (June 25, 2026) — Simpler Scanner UX, Service Probes by Hostname, Detection Engine v3
- **Earliest in file:** v1.0.0 (February 8, 2026) — First Release
