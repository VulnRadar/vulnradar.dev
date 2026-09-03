/**
 * Every modal surface in the product, and which tier of the grammar it uses.
 *
 * Hand-maintained on purpose: the point of the list is to be read next to the
 * running specimens above it and notice a row whose tier looks wrong for what
 * it does. A generated list would go stale in a different way (it would stay
 * accurate about the code and say nothing about whether the code is right).
 *
 * `shell`    three bands, scrolling body (components/ui/dialog.tsx)
 * `compact`  one padded box (a confirmation)
 * `sheet`    edge panel (components/ui/sheet.tsx)
 * `overlay`  non-Radix panel via components/ui/modal-shell.tsx
 * `takeover` full-screen, no panel and no scrim. Three surfaces are this on
 *            purpose and are listed so nobody "fixes" them into modals: two
 *            mobile navigation drawers, which cover the viewport rather than
 *            float over it, and the AI chat panel, which is dockable and
 *            resizable and leaves the page behind it usable. They share the
 *            grammar's surface tokens and its close chip, and nothing else.
 */
export interface InventoryEntry {
  name: string;
  source: string;
  tier: "shell" | "compact" | "sheet" | "overlay" | "takeover";
  size: string;
}

export const MODAL_INVENTORY: readonly InventoryEntry[] = [
  // Scan results and sharing
  {
    name: "Share scan report",
    source: "components/scanner/share-modal.tsx",
    tier: "shell",
    size: "sm",
  },
  {
    name: "AI summary",
    source: "components/scanner/ai-summary-modal.tsx",
    tier: "shell",
    size: "md",
  },
  {
    name: "AI verify result",
    source: "components/scanner/ai-verify-result-modal.tsx",
    tier: "shell",
    size: "md",
  },
  {
    name: "AI engine choice",
    source: "components/scanner/ai-choice-modal.tsx",
    tier: "overlay",
    size: "md",
  },
  {
    name: "Crawl URL selector",
    source: "components/scanner/crawl-url-selector.tsx",
    tier: "overlay",
    size: "lg",
  },
  {
    name: "Screenshot lightbox",
    source: "components/scanner/screenshot-panel.tsx",
    tier: "compact",
    size: "xl",
  },
  {
    name: "Scan actions (export, schedule, delete)",
    source: "components/scanner/scan-actions-menu.tsx",
    tier: "shell",
    size: "sm",
  },
  {
    name: "Mobile navigation",
    source: "components/scanner/header.tsx",
    tier: "sheet",
    size: "w-64",
  },

  // Repos
  {
    name: "GitHub repo picker",
    source: "components/repos/github-repo-picker-modal.tsx",
    tier: "shell",
    size: "lg",
  },
  {
    name: "GitHub scan result",
    source: "components/repos/github-scan-result-modal.tsx",
    tier: "shell",
    size: "md",
  },

  // Account and profile
  {
    name: "GitHub profile connect",
    source: "components/modals/github-profile-modal.tsx",
    tier: "shell",
    size: "sm",
  },
  {
    name: "Discord profile connect",
    source: "components/modals/discord-profile-modal.tsx",
    tier: "shell",
    size: "sm",
  },
  {
    name: "Avatar crop",
    source: "components/modals/image-crop-dialog.tsx",
    tier: "shell",
    size: "sm",
  },
  {
    name: "Premium upgrade",
    source: "components/modals/premium-upgrade-modal.tsx",
    tier: "shell",
    size: "sm",
  },
  {
    name: "Terms of service gate",
    source: "components/modals/tos-modal.tsx",
    tier: "overlay",
    size: "md",
  },
  {
    name: "Billing verification",
    source: "components/profile/modals/billing-verification-modal.tsx",
    tier: "compact",
    size: "sm",
  },
  {
    name: "Cancel subscription",
    source: "components/profile/tabs/profile-billing-tab.tsx",
    tier: "overlay",
    size: "sm",
  },
  {
    name: "Sign out everywhere",
    source: "components/profile/tabs/profile-security-tab.tsx",
    tier: "compact",
    size: "sm",
  },
  {
    name: "Disconnect social account",
    source: "components/profile/tabs/profile-social-tab.tsx",
    tier: "compact",
    size: "sm",
  },
  {
    name: "Reset AI settings",
    source: "components/profile/tabs/profile-ai-settings-tab.tsx",
    tier: "compact",
    size: "sm",
  },
  {
    name: "Revoke API key",
    source: "components/profile/tabs/profile-developer-tab.tsx",
    tier: "compact",
    size: "sm",
  },
  {
    name: "Remove verified domain",
    source: "components/profile/tabs/developer/domains-section.tsx",
    tier: "compact",
    size: "sm",
  },

  // Shared
  {
    name: "Confirm (the one confirmation dialog)",
    source: "components/shared/confirm-dialog.tsx",
    tier: "compact",
    size: "sm",
  },
  {
    name: "Save confirmation",
    source: "components/shared/save-confirmation-modal.tsx",
    tier: "compact",
    size: "sm",
  },
  {
    name: "Backup codes",
    source: "components/shared/notification-center.tsx",
    tier: "overlay",
    size: "md",
  },
  {
    name: "Site notification",
    source: "components/shared/site-notifications.tsx",
    tier: "overlay",
    size: "sm",
  },
  {
    name: "Onboarding tour",
    source: "components/shared/onboarding-tour.tsx",
    tier: "overlay",
    size: "lg",
  },
  {
    name: "Command palette",
    source: "components/shared/command-palette.tsx",
    tier: "shell",
    size: "max-w-xl",
  },

  // Admin
  {
    name: "Broadcast notification",
    source: "components/admin/notifications/notifications-manager.tsx",
    tier: "shell",
    size: "lg",
  },
  {
    name: "Mass email preview",
    source: "components/admin/features/mass-email-manager.tsx",
    tier: "shell",
    size: "max-w-5xl",
  },
  {
    name: "Email log detail",
    source: "components/admin/features/email-logs-manager.tsx",
    tier: "shell",
    size: "max-w-5xl",
  },
  {
    name: "Engine feedback promote",
    source: "components/admin/features/engine-feedback-manager.tsx",
    tier: "overlay",
    size: "sm",
  },
  {
    name: "IP rule detail",
    source: "components/admin/features/ip-rules-manager.tsx",
    tier: "overlay",
    size: "md",
  },
  {
    name: "Staff detail",
    source: "components/admin/staff/staff-list.tsx",
    tier: "overlay",
    size: "lg",
  },
  {
    name: "Invite staff",
    source: "components/admin/staff/staff-list.tsx",
    tier: "overlay",
    size: "md",
  },
  {
    name: "Team members",
    source: "components/admin/teams/teams-list.tsx",
    tier: "overlay",
    size: "md",
  },
  {
    name: "User detail actions",
    source: "components/admin/users/user-detail-panel.tsx",
    tier: "shell",
    size: "sm",
  },
  {
    name: "Gift subscription",
    source: "components/admin/users/gift-subscription-modal.tsx",
    tier: "shell",
    size: "sm",
  },
  {
    name: "Admin password confirm",
    source: "components/admin/shared/admin-password-confirm-dialog.tsx",
    tier: "compact",
    size: "sm",
  },
  {
    name: "Admin confirm",
    source: "components/admin/shared/confirm-dialog.tsx",
    tier: "compact",
    size: "sm",
  },

  // Deliberately not modals. See the tier note at the top of this file.
  {
    name: "Docs mobile navigation",
    source: "components/docs/docs-mobile-nav.tsx",
    tier: "takeover",
    size: "full",
  },
  {
    name: "Admin mobile contents",
    source: "components/admin/shared/admin-mobile-toc.tsx",
    tier: "takeover",
    size: "full",
  },
  {
    name: "AI chat panel",
    source: "components/ai-chat/chat-widget.tsx",
    tier: "takeover",
    size: "resizable",
  },

  // Owned by other workstreams during this pass, listed for completeness.
  {
    name: "Create team",
    source: "components/teams/team-create-dialog.tsx",
    tier: "compact",
    size: "md",
  },
];
