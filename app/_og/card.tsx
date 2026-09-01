import { APP_NAME } from "@/lib/config/constants";
import { BRAND } from "@/lib/config/brand";

/**
 * The one layout every dynamic social card in the app renders, so a shared
 * scan, a check page and a host report read as a family with the static
 * public/og-image.svg the site root still uses.
 *
 * Underscore-prefixed, so Next treats app/_og as a private folder and never
 * routes it.
 *
 * next/og renders with satori, which supports a subset of CSS: flexbox only,
 * every element with more than one child needs an explicit display, and there
 * is no cascade to inherit from. Hence the explicit widths and the inline
 * styles. No font is loaded on purpose: the product ships in the system stack
 * (nothing consumes a webfont anywhere in the app), so satori's default is
 * consistent with the product rather than a deviation.
 */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const INK = {
  bgTop: "#0a0e18",
  bgBottom: "#0e1526",
  card: "#141d30",
  stroke: "#26344d",
  text: "#ffffff",
  muted: "#93a3bd",
  accent: BRAND.primaryLight,
};

export interface OgSeverityCount {
  label: string;
  count: number;
  color: string;
}

/** The severity ramp from app/globals.css, in the order a report lists it. */
export function severityRow(counts: {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  info?: number;
}): OgSeverityCount[] {
  return [
    {
      label: "Critical",
      count: counts.critical ?? 0,
      color: BRAND.severity.critical,
    },
    { label: "High", count: counts.high ?? 0, color: BRAND.severity.high },
    {
      label: "Medium",
      count: counts.medium ?? 0,
      color: BRAND.severity.medium,
    },
    { label: "Low", count: counts.low ?? 0, color: BRAND.severity.low },
    { label: "Info", count: counts.info ?? 0, color: BRAND.severity.info },
  ];
}

export function OgCard({
  eyebrow,
  headline,
  accentTail,
  subline,
  chips,
  severities,
}: {
  /** Small uppercase label above the headline, e.g. "Shared scan report". */
  eyebrow: string;
  headline: string;
  /** Rendered in the brand blue directly after the headline. */
  accentTail?: string;
  subline?: string;
  /** Short bordered pills, e.g. a severity or a category. */
  chips?: { label: string; color?: string }[];
  severities?: OgSeverityCount[];
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px 72px",
        backgroundImage: `linear-gradient(135deg, ${INK.bgTop} 0%, ${INK.bgBottom} 100%)`,
        color: INK.text,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: INK.accent,
            marginRight: 14,
          }}
        />
        <div
          style={{
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: -0.5,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {APP_NAME}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 22,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: INK.muted,
            marginBottom: 18,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            fontSize: 62,
            fontWeight: 600,
            lineHeight: 1.12,
            letterSpacing: -1.5,
          }}
        >
          <span>{headline}</span>
          {accentTail ? (
            <span style={{ color: INK.accent, marginLeft: 16 }}>
              {accentTail}
            </span>
          ) : null}
        </div>
        {subline ? (
          <div
            style={{
              fontSize: 26,
              color: INK.muted,
              marginTop: 20,
              lineHeight: 1.4,
            }}
          >
            {subline}
          </div>
        ) : null}
        {chips && chips.length > 0 ? (
          <div style={{ display: "flex", marginTop: 26 }}>
            {chips.map((chip) => (
              <div
                key={chip.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  border: `1px solid ${chip.color ?? INK.stroke}`,
                  borderRadius: 999,
                  padding: "8px 20px",
                  marginRight: 14,
                  fontSize: 24,
                  color: chip.color ?? INK.muted,
                  backgroundColor: INK.card,
                }}
              >
                {chip.label}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {severities && severities.length > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            border: `1px solid ${INK.stroke}`,
            borderRadius: 16,
            backgroundColor: INK.card,
            padding: "22px 28px",
          }}
        >
          {severities.map((s) => (
            <div
              key={s.label}
              style={{
                display: "flex",
                alignItems: "center",
                marginRight: 44,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: s.color,
                  marginRight: 12,
                }}
              />
              <div style={{ fontSize: 28, fontWeight: 600, marginRight: 8 }}>
                {s.count}
              </div>
              <div style={{ fontSize: 24, color: INK.muted }}>{s.label}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", fontSize: 24, color: INK.muted }}>
          Scan any website for security issues in seconds. Just a URL.
        </div>
      )}
    </div>
  );
}
