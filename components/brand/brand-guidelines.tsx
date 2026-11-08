import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { LeadingIcon } from "@/components/shared/leading-icon";
import { APP_NAME, TOTAL_CHECKS_LABEL } from "@/lib/config/client-constants";
import {
  INTERFACE_FONTS,
  LOGO_PALETTE,
  SEVERITY_PALETTE,
  SOURCE_FILES,
  UI_PALETTE,
  WORDMARK_COLOURS,
  WORDMARK_FACE,
  WORDMARK_VIEWBOX,
  contrastRatio,
} from "@/lib/brand/kit";
import { cn } from "@/lib/ui/utils";
import { CopyHex } from "./copy-hex";
import { KitImage, KitSection } from "./kit-assets";

/**
 * A colour swatch as SVG rather than a styled box: a `style` attribute per
 * swatch would put thirty inline styles on the page, and our own scanner
 * reports three or more as a CSP hygiene finding.
 */
function Swatch({ hex, size = 40 }: { hex: string; size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      <rect
        x={0.5}
        y={0.5}
        width={size - 1}
        height={size - 1}
        rx={6}
        fill={hex}
        className="stroke-border"
        strokeWidth={1}
      />
    </svg>
  );
}

const ratio = (a: string, b: string) => `${contrastRatio(a, b).toFixed(1)}:1`;

const background = UI_PALETTE.find((t) => t.token === "background")!;

export function BrandColour() {
  return (
    <KitSection
      id="colour"
      tile="alt"
      title="Colour"
      intro={
        <p>
          The logo has five colours and never changes them. The interface has
          its own tokens, which shift between the light and the dark theme. In
          code, use the token (
          <code className="font-mono text-sm">text-primary</code>,{" "}
          <code className="font-mono text-sm">bg-card</code>), not the hex.
        </p>
      }
    >
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-14">
        <div>
          <h3 className="mb-1 text-base font-semibold tracking-tight text-foreground">
            In the logo
          </h3>
          <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
            Read out of favicon.svg itself, not picked to match it.
          </p>
          <ul className="divide-y divide-border/50 border-y border-border/50">
            {LOGO_PALETTE.map((colour) => (
              <li key={colour.hex} className="flex items-center gap-4 py-3">
                <Swatch hex={colour.hex} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {colour.name}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {colour.part}
                  </p>
                </div>
                <CopyHex value={colour.hex} name={colour.name} />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-1 text-base font-semibold tracking-tight text-foreground">
            In the interface
          </h3>
          <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
            The tokens in app/globals.css, as each theme renders them.
          </p>
          <table className="w-full border-y border-border/50 text-left text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Token
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Light
                </th>
                <th scope="col" className="py-2 pl-2 font-medium">
                  Dark
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {UI_PALETTE.map((t) => (
                <TokenRow key={t.token} entry={t} use={t.use} />
              ))}
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={3}
                  className="pt-6 pb-2 text-left font-medium text-muted-foreground"
                >
                  Severity, for findings only
                </th>
              </tr>
              {SEVERITY_PALETTE.map((t) => (
                <TokenRow key={t.token} entry={t} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </KitSection>
  );
}

function TokenRow({
  entry,
  use,
}: {
  entry: (typeof UI_PALETTE)[number] | (typeof SEVERITY_PALETTE)[number];
  use?: string;
}) {
  return (
    <tr>
      <th scope="row" className="py-3 pr-3 align-top font-normal">
        <span className="block font-medium text-foreground">{entry.name}</span>
        <code className="block break-all font-mono text-xs text-muted-foreground">
          --{entry.token}
        </code>
        {use && (
          <span className="mt-1 hidden text-xs text-muted-foreground sm:block">
            {use}
          </span>
        )}
      </th>
      {(["light", "dark"] as const).map((theme) => (
        <td
          key={theme}
          className={cn("py-3 align-top", theme === "light" ? "px-2" : "pl-2")}
        >
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3">
            <Swatch hex={entry[theme].hex} size={28} />
            <CopyHex
              value={entry[theme].hex}
              name={`${entry.name}, ${theme} theme,`}
            />
          </div>
        </td>
      ))}
    </tr>
  );
}

const HIERARCHY = [
  {
    role: "Page title (Tier A)",
    size: "30 px, 36 px from sm",
    sample: "Report a security issue",
    className: "text-3xl sm:text-4xl font-semibold tracking-tight",
  },
  {
    role: "Marketing section title",
    size: "24 px, 30 px from sm",
    sample: "Run it twice, get the same answer twice",
    className: "text-2xl sm:text-3xl font-semibold tracking-tight",
  },
  {
    role: "Sub-page title (Tier B)",
    size: "20 px, 24 px from sm",
    sample: "Attack surface",
    className: "text-xl sm:text-2xl font-semibold tracking-tight",
  },
  {
    role: "Panel-group heading",
    size: "18 px",
    sample: "Billing overview",
    className: "text-lg font-semibold tracking-tight",
  },
  {
    role: "Panel heading",
    size: "16 px",
    sample: "Verified domains",
    className: "text-base font-semibold tracking-tight",
  },
] as const;

export function BrandType() {
  return (
    <KitSection id="type" tile="base" title="Type">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-14">
        <div>
          <h3 className="mb-3 text-base font-semibold tracking-tight text-foreground">
            The wordmark
          </h3>
          {/* The master is navy, so it is shown on white in both themes:
              putting it on the dark page would mean recolouring it. */}
          <div className="mb-5 rounded-lg border border-border bg-white px-6 py-8">
            <KitImage
              path={SOURCE_FILES.wordmark}
              alt={APP_NAME}
              width={Math.round(WORDMARK_VIEWBOX.width)}
              height={WORDMARK_VIEWBOX.height}
              className="mx-auto h-auto w-full max-w-[24rem]"
            />
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Face</dt>
            <dd className="text-foreground">
              {WORDMARK_FACE.family} SemiBold, version {WORDMARK_FACE.version}
            </dd>
            <dt className="text-muted-foreground">License</dt>
            <dd className="text-foreground">{WORDMARK_FACE.license}</dd>
            <dt className="text-muted-foreground">Tracking</dt>
            <dd className="text-foreground">
              <span className="font-mono">{WORDMARK_FACE.tracking}</span>, the
              header&apos;s tracking-tight
            </dd>
            <dt className="text-muted-foreground">Delivered as</dt>
            <dd className="text-foreground">
              Outlined paths. Nobody needs the font to use the logo, and it
              cannot render in a fallback face.
            </dd>
          </dl>
        </div>

        <div>
          <h3 className="mb-3 text-base font-semibold tracking-tight text-foreground">
            The interface
          </h3>
          <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
            No web font. The app renders in the faces the visitor&apos;s system
            already has, through Tailwind&apos;s default stacks, unchanged.
            These two lines are live text in those stacks, on your machine.
          </p>
          <div className="space-y-6">
            <div>
              <p className="font-sans text-2xl tracking-tight text-foreground">
                Paste a URL and see what comes back.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Sans, for everything: headings, body, controls.
              </p>
              <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                {INTERFACE_FONTS.sans}
              </p>
            </div>
            <div>
              <p className="break-words font-mono text-lg text-foreground">
                content-security-policy: default-src &apos;self&apos;
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Mono, for code, headers, file names and IDs.
              </p>
              <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                {INTERFACE_FONTS.mono}
              </p>
            </div>
          </div>
        </div>
      </div>

      <h3 className="mt-14 mb-1 text-base font-semibold tracking-tight text-foreground">
        Hierarchy
      </h3>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground leading-relaxed">
        Picked by what the page is, not by how loud it should be. All semibold,
        all tracked tight, sentence case.
      </p>
      <ul className="divide-y divide-border/50 border-y border-border/50">
        {HIERARCHY.map((level) => (
          <li
            key={level.role}
            className="grid grid-cols-1 gap-1 py-4 sm:grid-cols-[minmax(0,1fr)_17rem] sm:items-baseline sm:gap-6"
          >
            <p className={cn(level.className, "text-balance text-foreground")}>
              {level.sample}
            </p>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">{level.role}</span>,{" "}
              {level.size}
            </p>
          </li>
        ))}
      </ul>
    </KitSection>
  );
}

const VOICE = [
  {
    instead: "Lightning fast, reliable results",
    write: "Same URL, same finding IDs, same severities, same evidence.",
  },
  {
    instead: "Developer first",
    write: "No agent, no sidecar container, no YAML.",
  },
  {
    instead: "Privacy focused",
    write: "GPL-3.0, self-hostable, no telemetry.",
  },
  {
    instead: "Comprehensive security coverage",
    write: `Paste a URL and get ${TOTAL_CHECKS_LABEL} security checks back, each with evidence and a fix.`,
  },
  { instead: "Get Started", write: "Create an account" },
  {
    instead: "We take security seriously",
    write:
      "If you have found a vulnerability, we want to hear about it before anyone else does.",
  },
] as const;

export function BrandVoice() {
  return (
    <KitSection id="voice" tile="contrast" title="Voice">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-14">
        <div className="space-y-3 text-muted-foreground leading-relaxed text-pretty">
          <p>
            Write like a developer explaining a result to another developer:
            what happened, what it means, what to do about it. Say what a thing
            does, not that it is fast or secure.
          </p>
          <p>
            Give the number when there is one, and take it from the code. Use
            sentence case. No em dashes: a colon, a comma or a new sentence does
            the job. It is fine to be blunt.
          </p>
        </div>
        {/* `relative` so the sr-only caption, which is absolutely
            positioned, stays inside this box instead of widening the page
            (tests/app/table-scroll-containment.test.ts). */}
        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Phrases to avoid, and what the product says instead
            </caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="w-2/5 py-2 pr-4 font-medium">
                  Instead of
                </th>
                <th scope="col" className="py-2 font-medium">
                  Write
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {VOICE.map((row) => (
                <tr key={row.instead}>
                  <td className="py-3 pr-4 align-top text-muted-foreground">
                    <s className="decoration-muted-foreground/60">
                      {row.instead}
                    </s>
                  </td>
                  <td className="py-3 align-top text-foreground">
                    {row.write}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            Every line on the right is copy the product ships today.
          </p>
        </div>
      </div>
    </KitSection>
  );
}

type Example = { label: string; surface: string; art: ReactNode };

const MARK = (className?: string) => (
  <KitImage
    path={SOURCE_FILES.mark}
    alt=""
    width={96}
    height={96}
    className={cn("h-20 w-20 sm:h-24 sm:w-24", className)}
  />
);

const DOS: Example[] = [
  { label: "Use it as shipped", surface: "bg-white", art: MARK() },
  {
    label: "Put it on a dark surface",
    surface: "dark bg-background",
    art: MARK(),
  },
  {
    label: "Keep the lockup whole",
    surface: "bg-white",
    art: (
      <KitImage
        path={SOURCE_FILES.lockup.horizontal["on-light"]}
        alt=""
        width={553}
        height={100}
        className="h-auto w-4/5"
      />
    ),
  },
];

const DONTS: Example[] = [
  {
    label: "Stretch or squash it",
    surface: "bg-white",
    art: MARK("scale-x-150"),
  },
  {
    label: "Recolour it",
    surface: "bg-white",
    art: MARK("hue-rotate-[150deg] saturate-150"),
  },
  {
    label: "Add a shadow or an outline",
    surface: "bg-white",
    art: MARK(
      "rounded-full ring-4 ring-amber-400 drop-shadow-[0_10px_8px_rgba(0,0,0,0.55)]",
    ),
  },
  {
    label: "Set it on a busy or clashing background",
    surface:
      "bg-[repeating-linear-gradient(45deg,#2563eb_0_10px,#f97316_10px_20px)]",
    art: MARK(),
  },
  {
    label: "Retype the wordmark in another font",
    surface: "bg-white",
    art: (
      <span className="flex items-center gap-2">
        {MARK("h-10 w-10 sm:h-10 sm:w-10")}
        <span className="font-serif text-2xl italic text-[#0f172a]">
          VulnRadar
        </span>
      </span>
    ),
  },
];

function ExampleTile({ example, ok }: { example: Example; ok: boolean }) {
  return (
    <figure>
      <div
        className={cn(
          // Wider on a phone, where the tiles stack: three 4:3 tiles a
          // column wide were a screen and a half of mostly empty surface.
          "flex aspect-[16/9] items-center justify-center overflow-hidden rounded-lg border border-border sm:aspect-[4/3]",
          example.surface,
        )}
      >
        {example.art}
      </div>
      <figcaption className="mt-2 flex gap-2 text-sm text-foreground">
        <LeadingIcon
          icon={ok ? Check : X}
          className={
            ok
              ? "text-[hsl(var(--success))]"
              : "text-[hsl(var(--severity-critical))]"
          }
        />
        <span>
          <span className="font-medium">{ok ? "Do:" : "Don't:"}</span>{" "}
          {example.label.charAt(0).toLowerCase() + example.label.slice(1)}
        </span>
      </figcaption>
    </figure>
  );
}

export function BrandDoDont() {
  return (
    <KitSection
      id="do-dont"
      tile="base"
      title="Do and don't"
      intro={
        <p>
          Drawn live on the real mark, so each one is exactly the mistake it
          names. Resizing is fine. Everything else here is not.
        </p>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {DOS.map((example) => (
          <ExampleTile key={example.label} example={example} ok />
        ))}
      </div>
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {DONTS.map((example) => (
          <ExampleTile key={example.label} example={example} ok={false} />
        ))}
      </div>
    </KitSection>
  );
}

export function BrandAccessibility() {
  const disc = LOGO_PALETTE[0].hex;
  const pairs = [
    {
      wordmark: "on-light",
      on: "White",
      hex: "#ffffff",
    },
    {
      wordmark: "on-light",
      on: "The light theme's page",
      hex: background.light.hex,
    },
    {
      wordmark: "on-dark",
      on: "The dark theme's page",
      hex: background.dark.hex,
    },
    { wordmark: "on-dark", on: "The disc's navy", hex: disc },
  ] as const;

  return (
    <KitSection id="accessibility" tile="alt" title="Accessibility">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-14">
        <div>
          <h3 className="mb-3 text-base font-semibold tracking-tight text-foreground">
            Alt text
          </h3>
          <div className="space-y-5 text-sm text-muted-foreground leading-relaxed">
            <div>
              <p className="mb-2">
                The mark or the lockup on its own is the name, so say the name:
              </p>
              <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground">
                {`<img src="vulnradar-logo-64x64.png" alt="${APP_NAME} logo">`}
              </pre>
            </div>
            <div>
              <p className="mb-2">
                Beside the name set as text, as in the site header, the mark is
                decoration. An empty alt stops a screen reader saying the name
                twice:
              </p>
              <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground">
                {`<img src="vulnradar-logo-32x32.png" alt=""> ${APP_NAME}`}
              </pre>
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-base font-semibold tracking-tight text-foreground">
            Which wordmark, on what
          </h3>
          <table className="w-full border-y border-border/50 text-left text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Wordmark
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  On
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Contrast
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {pairs.map((pair) => (
                <tr key={`${pair.wordmark}-${pair.hex}`}>
                  <td className="py-3 pr-3 align-top">
                    <span className="block text-foreground">
                      {pair.wordmark}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {WORDMARK_COLOURS[pair.wordmark]}
                    </span>
                  </td>
                  <td className="py-3 pr-3 align-top">
                    <span className="block text-foreground">{pair.on}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {pair.hex}
                    </span>
                  </td>
                  <td className="py-3 text-right align-top font-medium tabular-nums text-foreground">
                    {ratio(WORDMARK_COLOURS[pair.wordmark], pair.hex)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
            Every pair clears the 4.5:1 WCAG AA asks of body text. The other way
            round fails, which is why there are two variants. On a near-black
            page the navy disc itself is {ratio(disc, background.dark.hex)}{" "}
            against the background, so its edge fades and the blue arcs carry
            the shape. That is expected; do not add a ring to fix it.
          </p>
        </div>
      </div>
    </KitSection>
  );
}
