// BRAND PALETTE - the single source of truth for out-of-app surfaces.
//
// Email clients strip <link>ed CSS and can't read the `--primary` /
// `--severity-*` CSS variables the in-app UI uses (app/globals.css), so every
// transactional email has to inline literal hex. Left to their own devices,
// those hexes drift: the old email builder hardcoded a plain Tailwind blue that
// had nothing to do with the real brand colour. This module fixes that by
// defining the brand once, in plain hex, derived directly from the app's real
// colours. `lib/email/email.ts` and the admin email preview both consume it, so
// the colours in an email can no longer diverge from the product.
//
// Values mirror the .dark theme in app/globals.css. Keep them literal hex
// (not CSS vars): this is the config an email renderer can actually read.

export const BRAND = {
  // Brand blue. `primaryLight` is the app's --primary (213 94% 68% = #60a5fa);
  // `primary` is the same hue one step darker, used where a colour sits behind
  // a white button label or needs more weight against a dark surface.
  primary: "#3b82f6",
  primaryHover: "#2563eb",
  primaryLight: "#60a5fa",
  primaryPale: "#bfdbfe",
  onPrimary: "#ffffff",

  // Dark surfaces, from lightest content down to the canvas behind the card.
  // Mirrors --background / --card / --surface-2 / --border in the dark theme.
  bg: "#0b0e14",
  surface: "#12151c",
  surfaceRaised: "#1b1f28",
  border: "#252a34",
  borderStrong: "#333b48",

  // Text, from primary body copy down to the faintest footer line.
  // Mirrors --foreground / --muted-foreground and steps below it.
  text: "#f1f5f9",
  textMuted: "#9aa6b8",
  textFaint: "#68758a",
  textDim: "#4a5568",

  // Status tints for callouts: a dark, low-saturation background paired with a
  // lighter foreground of the same hue so text stays legible on it.
  info: "#60a5fa",
  infoBg: "#132840",
  infoText: "#bfdbfe",
  success: "#22c55e",
  successBg: "#0a2e1a",
  successLight: "#86efac",
  successPale: "#bbf7d0",
  successText: "#10b981",
  warning: "#f59e0b",
  warningBg: "#3a2408",
  warningLight: "#fbbf24",
  warningPale: "#fde9c8",
  danger: "#ef4444",
  dangerBg: "#3d0f12",
  dangerLight: "#fca5a5",
  dangerPale: "#fecaca",

  // Finding severity, matching --severity-* in app/globals.css. Distinct from
  // the status tints above: these rate a vulnerability, not a message tone.
  severity: {
    critical: "#ef4444",
    high: "#f97316",
    medium: "#e7b008",
    low: "#2a8ff4",
    info: "#7b899e",
  },
} as const;

export type BrandPalette = typeof BRAND;
