import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/client-constants";
import {
  BRAND_KIT_ZIP,
  CLEAR_SPACE,
  LOCKUP_MIN_WIDTH_PX,
  LOCKUP_SLOTS,
  LOCKUP_VARIANTS,
  LOGO_SIZES,
  MARK_DISC_DIAMETER,
  MARK_GRID,
  MARK_MIN_PX,
  PROFILE_NAVY_SCALE,
  PROFILE_NAVY_SIZES,
  PROFILE_SIZES,
  README_FILE,
  SOURCE_FILES,
  USE_TERMS,
  brandKitFiles,
  fitLockup,
  lockupBox,
  lockupFile,
  logoFile,
  profileFile,
  sourceLockupSize,
  type LockupVariant,
} from "@/lib/brand/kit";
import {
  BRAND_KIT_FILE_BYTES,
  BRAND_KIT_ZIP_BYTES,
} from "@/lib/brand/kit.generated";
import { focus } from "@/lib/ui/animations";
import { formatBytes } from "@/lib/ui/format-bytes";
import { cn } from "@/lib/ui/utils";
import {
  BrandAccessibility,
  BrandColour,
  BrandDoDont,
  BrandType,
  BrandVoice,
} from "./brand-guidelines";
import {
  DownloadChip,
  KitImage,
  KitSection,
  kitFileName,
  kitHref,
} from "./kit-assets";
import { LockupDownloads, type LockupSlotView } from "./lockup-downloads";

const sizeOf = (path: string) => formatBytes(BRAND_KIT_FILE_BYTES[path]);
const FILE_COUNT = brandKitFiles().length;
const STACKED = LOCKUP_SLOTS.filter(
  ([w, h]) => fitLockup(w, h).layout === "stacked",
).map(([w, h]) => `${w} × ${h}`);

/** The disc's own inset inside the mark's square, in disc diameters. */
const INSET = (MARK_GRID - MARK_DISC_DIAMETER) / 2 / MARK_DISC_DIAMETER;
const SQUARE = MARK_GRID / MARK_DISC_DIAMETER;
const WORDMARK_SHARE = Math.round(
  lockupBox("horizontal").wordmark.height * 100,
);
/** X at the size the site header draws the mark, 24px square. */
const HEADER_X = ((24 * MARK_DISC_DIAMETER) / MARK_GRID) * CLEAR_SPACE;
const HORIZONTAL = sourceLockupSize("horizontal");
const ZIP_SIZE = formatBytes(BRAND_KIT_ZIP_BYTES);

/**
 * The accent for lines and labels in the diagrams. --primary is a fill
 * colour and measures under 2:1 on the light page; --primary-text is the
 * same blue pitched for text and lines, and the tiles re-point it.
 */
const accentStroke = "stroke-[hsl(var(--primary-text))]";
const accentFill = "fill-[hsl(var(--primary-text))]";

const inlineLink = cn(
  "rounded-sm py-1.5 text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary",
  focus.ring,
);

/**
 * /brand. Every number on it is read from lib/brand/kit.ts (what the files
 * were drawn with) or lib/brand/kit.generated.ts (what they weigh), so the
 * page cannot describe a kit other than the one on disk.
 */
export function BrandKit() {
  return (
    <>
      <Hero />
      <TheLogo />
      <ClearSpace />
      <MarkDownloads />
      <LockupSection />
      <ProfilePictures />
      <BrandColour />
      <BrandType />
      <BrandVoice />
      <BrandDoDont />
      <BrandAccessibility />
      <Questions />
    </>
  );
}

function Hero() {
  return (
    <section aria-labelledby="brand-title" className="tile-base">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
          <div>
            <h1
              id="brand-title"
              className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance"
            >
              VulnRadar brand kit
            </h1>
            <p className="mb-8 max-w-xl text-base text-muted-foreground leading-relaxed text-pretty sm:text-lg">
              The mark at {LOGO_SIZES.length} sizes, the lockup cut to{" "}
              {LOCKUP_SLOTS.length} banner slots for light and dark backgrounds,
              avatars and the SVG sources. {USE_TERMS} No sign-in.
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <Button
                asChild
                size="lg"
                shape="pill"
                className="h-11 px-6 gap-2"
              >
                <a
                  href={kitHref(BRAND_KIT_ZIP)}
                  download={BRAND_KIT_ZIP}
                  className={cn("h-11", focus.ring)}
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Download everything
                  <span className="sr-only">, ZIP, {ZIP_SIZE}</span>
                </a>
              </Button>
              <p className="text-sm text-muted-foreground">
                ZIP, {ZIP_SIZE}, {FILE_COUNT} files.{" "}
                <a
                  href={kitHref(README_FILE)}
                  className={inlineLink}
                  download={kitFileName(README_FILE)}
                >
                  README
                </a>{" "}
                says what each one is for.
              </p>
            </div>
          </div>
          <ConstructionDrawing />
        </div>
      </div>
    </section>
  );
}

/**
 * The mark on the grid it is drawn on, with the two numbers that define it.
 * favicon.svg is the image; the grid, the dashed disc and the dimensions are
 * drawn over it from MARK_GRID and MARK_DISC_DIAMETER.
 */
function ConstructionDrawing() {
  const lines = Array.from({ length: MARK_GRID + 1 }, (_, i) => i);
  const inset = (MARK_GRID - MARK_DISC_DIAMETER) / 2;
  const c = MARK_GRID / 2;
  return (
    <figure className="mx-auto w-full max-w-[16rem] sm:max-w-[22rem]">
      <svg
        role="img"
        aria-labelledby="construction-title"
        viewBox={`-1 -3.6 ${MARK_GRID + 2} ${MARK_GRID + 7.4}`}
        width={352}
        height={420}
        className="h-auto w-full overflow-visible"
      >
        <title id="construction-title">
          {`The VulnRadar mark on its ${MARK_GRID}-unit grid. The disc is ${MARK_DISC_DIAMETER} units across.`}
        </title>
        <image
          href={kitHref(SOURCE_FILES.mark)}
          x={0}
          y={0}
          width={MARK_GRID}
          height={MARK_GRID}
        />
        <g className="stroke-primary/25" strokeWidth={1}>
          {lines.map((i) => (
            <g key={i}>
              <line
                x1={i}
                y1={0}
                x2={i}
                y2={MARK_GRID}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={0}
                y1={i}
                x2={MARK_GRID}
                y2={i}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
        </g>
        <circle
          cx={c}
          cy={c}
          r={MARK_DISC_DIAMETER / 2}
          fill="none"
          className={accentStroke}
          strokeWidth={1.5}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
        <g
          className="stroke-muted-foreground"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        >
          <line
            x1={0}
            y1={-1.5}
            x2={MARK_GRID}
            y2={-1.5}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            y1={-2.1}
            x2={0}
            y2={-0.9}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={MARK_GRID}
            y1={-2.1}
            x2={MARK_GRID}
            y2={-0.9}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={inset}
            y1={MARK_GRID + 1.5}
            x2={MARK_GRID - inset}
            y2={MARK_GRID + 1.5}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={inset}
            y1={MARK_GRID + 0.9}
            x2={inset}
            y2={MARK_GRID + 2.1}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={MARK_GRID - inset}
            y1={MARK_GRID + 0.9}
            x2={MARK_GRID - inset}
            y2={MARK_GRID + 2.1}
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g
          className="fill-muted-foreground font-mono"
          fontSize={1.15}
          textAnchor="middle"
        >
          <text x={c} y={-2.3}>
            {MARK_GRID}
          </text>
          <text x={c} y={MARK_GRID + 3.3}>
            {MARK_DISC_DIAMETER}
          </text>
        </g>
      </svg>
      <figcaption className="mt-2 text-sm text-muted-foreground text-pretty">
        favicon.svg, the master every file here is drawn from: a {MARK_GRID}
        -unit square, the disc {MARK_DISC_DIAMETER} across, one unit of air on
        each side.
      </figcaption>
    </figure>
  );
}

function TheLogo() {
  return (
    <section
      id="logo"
      aria-labelledby="logo-title"
      className="tile-alt scroll-mt-20"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-14">
          <div>
            <h2
              id="logo-title"
              className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4 text-balance"
            >
              The logo
            </h2>
            <p className="mb-6 text-muted-foreground leading-relaxed text-pretty">
              One mark and one wordmark. The mark is a navy disc with radar
              arcs, a white sweep and two contacts. The wordmark is
              &ldquo;VulnRadar&rdquo; in JetBrains Mono SemiBold, outlined, and
              stands {WORDMARK_SHARE}% as tall as the disc beside it.
            </p>
            <dl className="space-y-4 text-sm leading-relaxed">
              <div>
                <dt className="font-medium text-foreground">The mark alone</dt>
                <dd className="text-muted-foreground">
                  Favicons, app icons, avatars, and anywhere narrower than{" "}
                  {LOCKUP_MIN_WIDTH_PX} px.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">The lockup</dt>
                <dd className="text-muted-foreground">
                  Headers, READMEs, slides, social banners: anywhere with room
                  for the name.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">
                  Not from the parts
                </dt>
                <dd className="text-muted-foreground">
                  Use the lockup file, not the mark beside
                  &ldquo;VulnRadar&rdquo; typed in a font. The one exception is
                  a header that has to carry the name as live text for screen
                  readers and search engines, as ours does:{" "}
                  <a href="#accessibility" className={inlineLink}>
                    Accessibility
                  </a>{" "}
                  says how.
                </dd>
              </div>
            </dl>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(["on-light", "on-dark"] as const).map((variant) => (
              <figure key={variant}>
                <div
                  className={cn(
                    "flex aspect-[4/3] flex-col justify-between rounded-lg border border-border p-6",
                    variant === "on-dark" ? "dark bg-background" : "bg-white",
                  )}
                >
                  <KitImage
                    path={SOURCE_FILES.mark}
                    alt="VulnRadar mark"
                    width={64}
                    height={64}
                    className="h-16 w-16"
                  />
                  <KitImage
                    path={SOURCE_FILES.lockup.horizontal[variant]}
                    alt="VulnRadar logo"
                    width={HORIZONTAL.width}
                    height={HORIZONTAL.height}
                    className="h-auto w-full"
                  />
                </div>
                <figcaption className="mt-2 text-sm text-muted-foreground">
                  {variant === "on-light"
                    ? "On a light surface: the navy wordmark."
                    : "On a dark surface: the light wordmark."}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Clear space, drawn from the numbers rather than shown as a picture of
 * itself. Units are disc diameters (D), so X is CLEAR_SPACE wherever it
 * appears; the image sits exactly in the inner box because its square is
 * offset by the disc's one-unit inset.
 */
function ClearSpaceDiagram({ kind }: { kind: "mark" | "lockup" }) {
  const box =
    kind === "mark" ? { width: 1, height: 1 } : lockupBox("horizontal");
  const x = CLEAR_SPACE;
  const w = box.width + 2 * x;
  const h = box.height + 2 * x;
  const corners = [
    [0, 0],
    [box.width + x, 0],
    [0, box.height + x],
    [box.width + x, box.height + x],
  ];
  const label =
    kind === "mark"
      ? "The mark with X of clear space on every side"
      : "The lockup with X of clear space on every side";
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${w} ${h}`}
      width={Math.round(w * 160)}
      height={Math.round(h * 160)}
      className="h-auto w-full"
    >
      <rect
        width={w}
        height={h}
        className={cn("fill-primary/5", accentStroke)}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
      {corners.map(([cx, cy]) => (
        <rect
          key={`${cx}-${cy}`}
          x={cx}
          y={cy}
          width={x}
          height={x}
          className="fill-primary/20"
        />
      ))}
      <rect
        x={x}
        y={x}
        width={box.width}
        height={box.height}
        fill="none"
        className={accentStroke}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={x / 2}
        y={x / 2}
        fontSize={x * 0.55}
        textAnchor="middle"
        dominantBaseline="central"
        className={cn(accentFill, "font-mono font-semibold")}
      >
        X
      </text>
      {kind === "mark" ? (
        <image
          href={kitHref(SOURCE_FILES.mark)}
          x={x - INSET}
          y={x - INSET}
          width={SQUARE}
          height={SQUARE}
        />
      ) : (
        LOCKUP_VARIANTS.map((variant) => (
          <image
            key={variant}
            href={kitHref(SOURCE_FILES.lockup.horizontal[variant])}
            x={x}
            y={x}
            width={box.width}
            height={box.height}
            className={
              variant === "on-light" ? "dark:hidden" : "hidden dark:inline"
            }
          />
        ))
      )}
    </svg>
  );
}

function ClearSpace() {
  return (
    <KitSection
      id="clear-space"
      tile="base"
      title="Clear space and minimum size"
      intro={
        <p>
          X is {CLEAR_SPACE * 100}% of the disc&apos;s diameter. Keep at least X
          clear on every side of the mark and of the lockup: no text, no icon,
          no edge of the page or of the card it sits on. Every banner file
          already has it built in.
        </p>
      }
    >
      <div className="mb-10 grid grid-cols-1 items-end gap-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <div className="max-w-[12rem]">
          <ClearSpaceDiagram kind="mark" />
        </div>
        <ClearSpaceDiagram kind="lockup" />
      </div>

      <dl className="grid grid-cols-1 divide-y divide-border/50 border-y border-border/50 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="flex items-center gap-4 py-5 sm:px-6 sm:first:pl-0">
          <KitImage
            path={logoFile(MARK_MIN_PX)}
            alt=""
            width={MARK_MIN_PX}
            height={MARK_MIN_PX}
            className="h-4 w-4 shrink-0"
          />
          <div>
            <dt className="text-sm text-muted-foreground">Mark, at least</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">
              {MARK_MIN_PX} px
            </dd>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-5 sm:px-6">
          <KitImage
            path={SOURCE_FILES.lockup.horizontal["on-light"]}
            alt=""
            width={LOCKUP_MIN_WIDTH_PX}
            height={Math.round(
              LOCKUP_MIN_WIDTH_PX / lockupBox("horizontal").width,
            )}
            className="shrink-0 dark:hidden"
          />
          <KitImage
            path={SOURCE_FILES.lockup.horizontal["on-dark"]}
            alt=""
            width={LOCKUP_MIN_WIDTH_PX}
            height={Math.round(
              LOCKUP_MIN_WIDTH_PX / lockupBox("horizontal").width,
            )}
            className="hidden shrink-0 dark:block"
          />
          <div>
            <dt className="text-sm text-muted-foreground">Lockup, at least</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">
              {LOCKUP_MIN_WIDTH_PX} px wide
            </dd>
          </div>
        </div>
        <div className="py-5 sm:px-6">
          <dt className="text-sm text-muted-foreground">
            X at the header&apos;s 24 px mark
          </dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">
            {HEADER_X} px
          </dd>
        </div>
      </dl>
      <p className="mt-4 max-w-2xl text-sm text-muted-foreground leading-relaxed">
        Both minimums are shown at their real size. Under {LOCKUP_MIN_WIDTH_PX}{" "}
        px the mark inside the lockup falls below its own {MARK_MIN_PX} px and
        the bowls of the a and the d close up, so use the mark alone.
      </p>
    </KitSection>
  );
}

function MarkDownloads() {
  return (
    <KitSection
      id="download-mark"
      tile="contrast"
      title="Download the mark"
      intro={
        <p>
          Transparent PNGs, the disc exactly as favicon.svg draws it. Take the
          size at or above the one you need, or the SVG for anything else.
        </p>
      }
    >
      <ul
        aria-label="Mark PNGs"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
      >
        {[...LOGO_SIZES].reverse().map((size) => (
          <li key={size}>
            <DownloadChip
              path={logoFile(size)}
              label={`${size} × ${size}`}
              detail={`PNG, ${sizeOf(logoFile(size))}`}
              context="the mark"
            />
          </li>
        ))}
        <li>
          <DownloadChip
            path={SOURCE_FILES.mark}
            label="Any size"
            detail={`SVG, ${sizeOf(SOURCE_FILES.mark)}`}
            context="the mark"
          />
        </li>
      </ul>
    </KitSection>
  );
}

function LockupSection() {
  const slots: LockupSlotView[] = LOCKUP_SLOTS.map(([width, height]) => ({
    width,
    height,
    layout: fitLockup(width, height).layout,
    files: Object.fromEntries(
      LOCKUP_VARIANTS.map((variant) => {
        const path = lockupFile(variant, width, height);
        return [variant, { path, size: sizeOf(path) }];
      }),
    ) as Record<LockupVariant, { path: string; size: string }>,
  }));
  const sources = [
    ["Mark", SOURCE_FILES.mark],
    ["Wordmark", SOURCE_FILES.wordmark],
    ["Lockup, on dark", SOURCE_FILES.lockup.horizontal["on-dark"]],
    ["Lockup, on light", SOURCE_FILES.lockup.horizontal["on-light"]],
    ["Stacked, on dark", SOURCE_FILES.lockup.stacked["on-dark"]],
    ["Stacked, on light", SOURCE_FILES.lockup.stacked["on-light"]],
  ] as const;

  return (
    <KitSection
      id="download-lockup"
      tile="contrast"
      title="Download the lockup"
      className="pt-4 sm:pt-6"
      intro={
        <p>
          Each file is the exact slot size, transparent, with the lockup centred
          and at least X of clear space around it. {STACKED.join(" and ")} are
          stacked, mark over the wordmark, because a horizontal lockup would
          come out smaller in them.
        </p>
      }
    >
      <LockupDownloads slots={slots} />

      <h3 className="mt-12 mb-3 text-base font-semibold tracking-tight text-foreground">
        Vector files
      </h3>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground leading-relaxed">
        For print, or any size that is not above. Each one is tight to its
        artwork, so add the clear space yourself.
      </p>
      <ul
        aria-label="SVG sources"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      >
        {sources.map(([label, path]) => (
          <li key={path}>
            <DownloadChip
              path={path}
              label={label}
              detail={`SVG, ${sizeOf(path)}`}
            />
          </li>
        ))}
      </ul>
    </KitSection>
  );
}

function ProfilePictures() {
  const largest = PROFILE_SIZES[PROFILE_SIZES.length - 1];
  return (
    <KitSection id="profile" tile="base" title="Profile pictures">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-14">
        <div className="flex flex-wrap items-end gap-6 self-start">
          <figure>
            <KitImage
              path={profileFile(largest)}
              alt="VulnRadar profile picture"
              width={128}
              height={128}
              className="h-28 w-28 rounded-full sm:h-32 sm:w-32"
            />
            <figcaption className="mt-2 text-sm text-muted-foreground">
              Transparent
            </figcaption>
          </figure>
          <figure>
            <KitImage
              path={profileFile(PROFILE_NAVY_SIZES[0], true)}
              alt="VulnRadar profile picture on navy"
              width={128}
              height={128}
              className="h-28 w-28 rounded-lg sm:h-32 sm:w-32"
            />
            <figcaption className="mt-2 text-sm text-muted-foreground">
              Navy, for slots that reject transparency
            </figcaption>
          </figure>
        </div>

        <div>
          <div className="mb-6 space-y-3 text-muted-foreground leading-relaxed text-pretty">
            <p>
              The disc fills the whole square, so a platform that crops avatars
              to a circle shows the mark and nothing around it. GitHub and
              Discord keep transparency: use these there.
            </p>
            <p>
              The navy ones are for a slot that flattens transparency. A JPEG
              has none at all, and Apple rejects an App Store icon that has any.
              They fill the square with the disc&apos;s navy and draw the radar
              at {PROFILE_NAVY_SCALE * 100}%, so a circular crop still leaves
              the arcs a margin.
            </p>
          </div>
          <ul
            aria-label="Profile pictures"
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {[...PROFILE_SIZES].reverse().map((size) => (
              <li key={size}>
                <DownloadChip
                  path={profileFile(size)}
                  label={`${size} × ${size}`}
                  detail={`Transparent PNG, ${sizeOf(profileFile(size))}`}
                  context="transparent profile picture"
                />
              </li>
            ))}
            {[...PROFILE_NAVY_SIZES].reverse().map((size) => (
              <li key={`${size}-navy`}>
                <DownloadChip
                  path={profileFile(size, true)}
                  label={`${size} × ${size}`}
                  detail={`Navy PNG, ${sizeOf(profileFile(size, true))}`}
                  context="profile picture on navy"
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </KitSection>
  );
}

function Questions() {
  return (
    <section aria-label="Questions" className="tile-base">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-muted-foreground">
          A size or a format that is not here?{" "}
          <Link href={ROUTES.CONTACT} className={inlineLink}>
            Ask for it on the contact page
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
