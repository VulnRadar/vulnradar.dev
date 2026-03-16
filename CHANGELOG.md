# Changelog

All notable changes to VulnRadar are documented in this file.

## [v2.0.4] - Legal Pages & Compliance Updates

### Privacy Policy (Enhanced)
- Added clarification that VulnRadar is "operated by an independent developer" with data processing in the United States
- Enhanced Discord OAuth section to specify "basic account information including... email address if available"
- Improved Cloudflare Turnstile CAPTCHA description with "limited device, browser, and interaction data"
- Added **Security Disclaimer** explicitly stating no method of transmission is completely secure
- Updated breach notification timeline from "72 hours" to "without unreasonable delay, consistent with applicable law"
- Added **Section 13: Legal Compliance** - law enforcement disclosure clause
- Added **Section 14: Business Transfers** - merger/acquisition notification clause
- Added **Section 15: Authorized Scanning Responsibility** - clarifies users must have authorization for each target scanned
- Renumbered remaining sections (16-18)

### Terms of Service (New Disclaimers)
- Added **Security Tool Disclaimer** in Section 1 stating scan results are informational only and may contain false positives/negatives
- Added **Service Availability Disclaimer** clarifying the Service is not guaranteed to be uninterrupted, secure, or error-free

### Acceptable Use Policy (Security Rule)
- Added explicit **"No Automated Mass Scanning"** rule prohibiting large-scale internet-wide scanning or systematic enumeration without explicit per-target authorization

### DMCA & Copyright Policy
- Fixed page structure to use `PublicPageShell` for consistent public-facing header and footer
- Removed logged-in-only Header/Footer components

### Accessibility Statement (Enhanced)
- Enhanced **Third-party content** note with direct email contact link for users unable to complete CAPTCHA challenges
- Improved **PDF exports** disclaimer with contact option for accessible report formats
- Updated **Browser support** note to recommend keeping browsers up to date for optimal accessibility
- Added caveat to **Feedback timeline** noting response times may vary during high volume periods
- Fixed page structure to use `PublicPageShell` for consistent public-facing header and footer

### Footer & Navigation
- **Logged-in users**: Reorganized Legal section footer with proper link order (Terms, Privacy, Acceptable Use, Disclaimer, DMCA, Accessibility, GDPR)
- **Guest users**: Removed Pricing button from legal page footer (legal pages now show only legal links)
- Added `/legal/dmca` and `/legal/accessibility` to `PUBLIC_PATHS` for public access without login

### Accessibility Compliance
- All legal pages now correctly render with public-facing header and footer when users are not logged in
- Improved navigability between legal documents with consistent link structure

---

## Previous Versions

Changelog history for versions prior to v2.0.4 not available.
