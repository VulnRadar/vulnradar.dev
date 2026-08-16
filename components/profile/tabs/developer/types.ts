// Shared types for the Developer tab's sub-sections (API Keys, Webhooks,
// Scheduled Scans). Split out so the section components and the shell that
// hosts them can both reference these without a circular import.

// Every destructive action across the Developer sub-sections (rotate/revoke
// a key, delete a webhook or a schedule) routes through one confirmation
// dialog owned by the shell, instead of firing on click, since none of them
// can be undone once the request lands.
// Domains has its own self-contained delete-confirmation dialog (see
// domains-section.tsx) rather than routing through ConfirmAction below: it
// manages its own list state independently (its own fetch, add, verify),
// unlike the other three sections, which all read/write state the shell
// owns so rotate/revoke/delete can share one dialog instance.
export type ConfirmAction =
  | { kind: "rotate-key"; id: number; label: string }
  | { kind: "revoke-key"; id: number; label: string }
  | { kind: "delete-webhook"; id: number; label: string }
  | { kind: "delete-schedule"; id: number; label: string };

export type DeveloperSection =
  "api-keys" | "webhooks" | "schedules" | "domains";
