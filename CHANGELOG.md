# Changelog

All notable changes to VulnRadar are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-03-21

### Added

#### UI/UX Improvements
- Complete visual revamp of core pages (Dashboard, History, Compare, Shared, Teams, Profile, Badge, Admin)
- Vercel-inspired design system with modern card layouts and improved visual hierarchy
- Sidebar navigation for profile and settings pages
- Enhanced admin panel with cleaner tables and better data visualization
- New loading states and error boundaries throughout the application
- Improved stat cards with colored icon backgrounds and better typography
- Better mobile responsiveness with collapsible sidebars

#### Dashboard
- Redesigned stat cards with larger typography and hover effects
- Activity chart with gradient bars and improved tooltips
- Severity breakdown with visual hierarchy and tabular layout
- Recent scans with relative timestamps and source icons
- Top issues section with count badges

#### Scan Results
- Improved scan summary with unified card design and check counts
- Enhanced results list with search and filtering
- Collapsible issue detail sections with severity bars and code blocks
- Better evidence display with "live" indicators
- References section for external links

#### Admin Features
- Fixed staff role detection to include moderator and support roles (not just admin)
- Staff roles now correctly show unlimited access in billing section
- Support actions now require confirmation modal with email notifications
- Forced email notifications for all support actions (cannot be disabled)
- Improved user detail view with two-column layout

#### Share & Collaboration
- Redesigned share modal with social share buttons and link copy
- Shared scan page with improved branding and layout
- Share management page with status badges and action dropdowns
- Simple loading states instead of fancy animations

#### Teams & Badges
- Cleaner team management interface with search and better member display
- Improved team join page with better visual hierarchy
- Redesigned badge embed page with split-panel layout

#### Billing & Notifications
- Fixed billing display for staff users showing "Unlimited Access"
- Support roles (admin, moderator, support) all get unlimited access

### Changed

- Admin page API calls now use correct endpoints (`?section=` parameters)
- Compare page header simplified without icon
- All tab navigation updated to remove top-level refresh buttons
- Reduced visual clutter in modals and cards
- Better spacing and padding consistency across all pages
- Support action flows now use centralized confirmation modal

### Fixed

- Fixed sorting in vulnerability results (High to Low / Low to High now works correctly)
- Fixed missing icon backgrounds in stat cards (especially amber/orange colors)
- Staff role detection now includes all staff types (admin, moderator, support)
- Billing API now correctly identifies staff roles for unlimited access
- Support actions now consistently send email notifications
- Admin page loading states and error handling

## [2.0.6] - 2026-03-15

### Added

#### Support Action Confirmation System
- Added SaveConfirmationModal integration for support actions
- Email notification system with user notification option for admin actions
- Confirmation workflow for all destructive support actions

#### Support Actions Email Notifications
- Automatic email notifications for:
  - Force logout (revoke all sessions)
  - Revoke API keys
  - Force logout all (sessions + API keys)
  - Reset password
  - Account disable/enable
  - And other administrative actions

#### Admin Functionality
- Comprehensive admin panel for user management
- Support action queue system with pending action state
- Better error handling and user feedback
- Action logging and audit trails

### Changed

- Admin support actions now require confirmation before execution
- Email notifications are always enabled for support actions (no toggle)
- Better visual feedback for pending operations

### Fixed

- Email notification logic for admin account changes
- Support action error handling and user feedback
- Modal component state management for support actions

## [2.0.5] - 2026-03-10

### Added

- Initial release of comprehensive admin panel
- User management interface
- Team management features
- Audit logging
- Administrative action system

### Fixed

- Various UI/UX improvements
- Performance optimizations
- Bug fixes for edge cases

---

## Installation & Usage

See [README.md](./README.md) and [Documentation](https://vulnradar.dev/docs) for setup and usage instructions.

## Contributing

We welcome contributions! Please see our [GitHub repository](https://github.com/VulnRadar/vulnradar.dev) for contribution guidelines.

## Support

For issues, bug reports, or feature requests, please visit [GitHub Issues](https://github.com/VulnRadar/vulnradar.dev/issues).
