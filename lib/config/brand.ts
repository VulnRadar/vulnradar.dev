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

  // Callout surfaces, one pair per message tone. A callout is a tinted box
  // with a hairline edge of the same hue, which is how the in-app UI draws one
  // (`bg-primary/10 border-primary/20`). It is NOT a grey box with a thick
  // coloured bar down one side: that pattern put a 3px stripe of `warning`
  // next to brand blue in every security notice, and the two hues fought.
  callout: {
    brand: { bg: "#132840", edge: "#1e3a5f" },
    ok: { bg: "#0a2e1a", edge: "#14532d" },
    warn: { bg: "#3a2408", edge: "#573713" },
    bad: { bg: "#3d0f12", edge: "#5c1a1e" },
    neutral: { bg: "#1b1f28", edge: "#252a34" },
  },

  // Finding severity, matching --severity-* in app/globals.css. Distinct from
  // the status tints above: these rate a vulnerability, not a message tone.
  severity: {
    critical: "#ef4444",
    high: "#f97316",
    medium: "#e7b008",
    low: "#2a8ff4",
    info: "#7b899e",
  },

  // LIGHT-SURFACE VARIANTS, for email.
  //
  // Everything above is the dark theme, which is right for the PDF report and
  // the OG cards (they control their own canvas) and wrong for email, which
  // is read on white far more often than not. The dark values do not survive
  // that move: #60a5fa on white is 2.16:1 and #9aa6b8 is 2.28:1, both far
  // under the 4.5:1 WCAG AA floor for body text, so a dark-only palette
  // either forces every message to paint itself black in an otherwise light
  // inbox or renders unreadable the moment a client drops the background.
  //
  // Emails therefore render light by default and swap to the dark set above
  // under prefers-color-scheme (lib/email/layout.ts). Every value here is
  // measured against the surface it is actually used on, not just white:
  // `surface` (#ffffff) for body copy and `surfaceRaised` (#f2f5f9) for the
  // detail panels and callouts, which is the tighter of the two.
  onLight: {
    // Canvas behind the card.
    //
    // This used to be the light theme's --background (213 25% 90% = #dfe5ec)
    // read straight off app/globals.css, and it was the wrong value to borrow.
    // In the app that tone sits UNDER --card (213 22% 95%), one quiet step
    // apart; in email the card is white, so the same canvas became a
    // saturated blue-grey slab with a white rectangle floating on it. It read
    // as muddy rather than as a page. Two steps lighter and slightly less
    // saturated, the canvas reads as margin and the card reads as the sheet.
    canvas: "#eef1f6",
    // The card itself. White rather than the app's --card, because the whole
    // message sits on it and the extra step buys contrast everywhere at once.
    surface: "#ffffff",
    // Detail panels, callouts, the one-time-code block. Sits inside the white
    // card, never against the canvas, so the two being close is fine.
    surfaceRaised: "#f5f7fa",
    // Hairline. Lighter than the old #d3dae4: with the card's blue top bar
    // gone this edge is the only thing separating card from canvas, and it
    // should read as a fold, not a frame.
    border: "#e3e8f0",
    // Control edge: the severity chips and anything button-shaped.
    borderStrong: "#cbd3e0",

    // 17.8:1 on surface. Mirrors --foreground (220 20% 10%).
    text: "#14181f",
    // 7.37:1 on surface, 7.29:1 on surfaceRaised, 6.66:1 on canvas.
    // Mirrors --muted-foreground (220 12% 35%).
    textMuted: "#4f5664",
    // Footer fine print, on the canvas rather than the card: 5.38:1 there.
    textFaint: "#5a6270",

    // Button fill. White label on it is 5.17:1. Same hex as primaryHover
    // above, so the light button is the app's own hover blue rather than a
    // colour invented for email.
    primary: "#2563eb",
    // Link and accent TEXT. primaryLight (#60a5fa) is 2.16:1 on white, so
    // link text needs its own darker value: 6.48:1 on surface, 5.93:1 on
    // surfaceRaised.
    primaryText: "#065ac1",
    onPrimary: "#ffffff",

    // Status tints. Foregrounds are measured on surfaceRaised, where every
    // callout actually sits.
    success: "#047857", // 5.48:1 on surface, 5.01:1 on surfaceRaised
    successBg: "#e8f6ef",
    warning: "#92400e", // 7.09:1 on surface, 6.48:1 on surfaceRaised
    warningBg: "#fdf3e3",
    danger: "#b91c1c", // 6.47:1 on surface, 5.92:1 on surfaceRaised
    dangerBg: "#fdecec",
    infoBg: "#e9f1fd",

    // Callout surfaces, the light half of the pairs above. Backgrounds are
    // 3-5% off white so the box reads as a tint rather than a grey slab, and
    // each edge is the same hue two steps down, which is what makes a callout
    // look like the app's `bg-x/10 border-x/20` instead of a bordered table
    // cell. textMuted on every one of these clears 7:1.
    callout: {
      brand: { bg: "#eef4ff", edge: "#cfe0fb" },
      ok: { bg: "#eafaf1", edge: "#bfe6d1" },
      warn: { bg: "#fdf5e6", edge: "#f0dcb0" },
      bad: { bg: "#fdeeee", edge: "#f5d0d0" },
      neutral: { bg: "#f5f7fa", edge: "#e3e8f0" },
    },

    // Severity, re-derived for a light ground. The dark ramp fails here:
    // #ef4444 is 3.76:1 on white and #e7b008 is 1.9:1, so a chip row would
    // be decoration rather than information. Hues are held (red, orange,
    // amber, blue, slate) and only lightness moves.
    severity: {
      critical: "#b91c1c", // 6.47:1 on surface, 5.92:1 on surfaceRaised
      high: "#a83a06", // 6.39:1 / 5.86:1
      medium: "#8a5406", // 6.27:1 / 5.73:1
      low: "#1d4ed8", // 6.70:1 / 6.13:1
      info: "#475569", // 7.58:1 / 6.93:1
    },
  },
} as const;
