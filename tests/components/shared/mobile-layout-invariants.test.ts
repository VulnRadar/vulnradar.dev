import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Pins the layout invariants a phone depends on. Everything here was a live
 * bug at some point and every one of them is invisible on a desktop browser,
 * which is why they kept coming back.
 *
 * Source-text assertions on purpose, same reasoning as
 * tests/components/shared/public-page-shells.test.ts: vitest.config.ts runs
 * `node`, there is no DOM and no jsdom, and there would be no layout engine to
 * measure even if there were. What is worth pinning is the class contract, and
 * that is visible in the source.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Source with comments stripped. Several of these files explain the bug they
 * fixed in a comment that names the very class the assertion looks for, so
 * matching the prose would let a regression pass on its own documentation.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Everything pinned to the bottom edge of the viewport. The cookie notice is
 * z-60 and mounted last in the root layout, so at a flat `bottom-0`/`bottom-4`
 * it painted over every one of these: on a phone it is roughly 125px tall,
 * which is enough to bury a save bar completely.
 * components/shared/cookie-notice.tsx publishes its measured height as
 * --vr-cookie-h for exactly this, so anything anchored to that edge has to
 * read it.
 */
const BOTTOM_PINNED = [
  "app/profile/page.tsx",
  "components/admin/users/user-detail-panel.tsx",
  "components/admin/features/system-settings-manager.tsx",
  "components/admin/shared/admin-mobile-toc.tsx",
  "components/admin/shared/toast.tsx",
  "components/shared/offline-banner.tsx",
  "components/shared/site-notifications.tsx",
  "components/scanner/results-list.tsx",
  "components/docs/docs-mobile-nav.tsx",
  "components/ai-chat/chat-widget.tsx",
  "components/ui/toast.tsx",
];

/**
 * Files with a sticky or fixed element anchored to the TOP edge. Two banners
 * can be up there at once and both publish their height: --vr-banner-h
 * (components/shared/site-notifications.tsx) and --vr-imp-banner-h
 * (components/admin/impersonation-banner.tsx). The impersonation banner is
 * z-60, above every header in the app, so a consumer that offset by only the
 * first variable had the amber banner painted straight over its nav for the
 * whole impersonation session.
 */
const TOP_PINNED = [
  "components/scanner/header.tsx",
  "components/landing/landing-nav.tsx",
  // components/pricing/pricing-skeleton.tsx used to be listed here. It carried
  // a hand-rolled copy of LandingNav, offset and all, which had drifted to
  // three nav links against the real nav's five and had neither the theme
  // toggle nor the mobile menu button. It renders PublicPageShell now, so the
  // nav above is the only implementation of this offset it can have.
  // components/billing/checkout-skeleton.tsx and app/checkout/[productId]/
  // page.tsx used to be listed here, each with its own copy of the subscription
  // funnel's sticky "Back to plans" bar and the spacer under it. They share
  // CheckoutShell now, the way the app pages share AppPageShell, so this is the
  // only implementation of that offset left on the route.
  "components/billing/checkout-shell.tsx",
  // The three credit top-ups used to be listed here, each with its own copy of
  // this sticky header. They are /ai-credits, /github-credits and
  // /browser-credits now and carry the app's real <Header /> (already pinned
  // above via components/scanner/header.tsx) instead of a private one, so
  // there is no second implementation of the offset left to drift.
  "app/profile/page.tsx",
  "app/admin/page.tsx",
];

/**
 * The scanner result panels that open onto a sticky bar carrying the scanned
 * hostname. A hostname is a single unbreakable token, so without `truncate` it
 * sets the bar's min width and pushes the summary line, the count and the
 * refresh control out of a card whose root is overflow-hidden. The content is
 * not clipped by a scrollbar, it is simply gone.
 *
 * `truncate` alone is the whole contract: its `overflow: hidden` is what makes
 * the flex item's automatic minimum size zero, since `min-width: auto` only
 * applies while `overflow` is `visible`. A `min-w-0` beside it is belt and
 * braces, not a requirement, so this does not insist on one.
 */
const HOST_BAR_PANELS = [
  "components/scanner/dns-records-panel.tsx",
  "components/scanner/port-scan-panel.tsx",
  "components/scanner/threat-intel-panel.tsx",
  "components/scanner/software-inventory-panel.tsx",
];

describe("bottom-pinned overlays clear the cookie notice", () => {
  it.each(BOTTOM_PINNED)("%s offsets by --vr-cookie-h", (rel) => {
    expect(code(rel)).toContain("--vr-cookie-h");
  });

  it("cookie-notice.tsx is the one publishing that height", () => {
    const src = code("components/shared/cookie-notice.tsx");
    expect(src).toContain('setProperty("--vr-cookie-h"');
    expect(src).toContain("ResizeObserver");
  });
});

describe("top-pinned headers clear both banners", () => {
  it.each(TOP_PINNED)("%s offsets by --vr-imp-banner-h too", (rel) => {
    const src = code(rel);
    expect(src).toContain("--vr-banner-h");
    expect(src).toContain("--vr-imp-banner-h");
  });

  it("impersonation-banner.tsx is the one publishing that height", () => {
    const src = code("components/admin/impersonation-banner.tsx");
    expect(src).toContain('setProperty("--vr-imp-banner-h"');
  });
});

describe("scanner panel host bars truncate", () => {
  it.each(HOST_BAR_PANELS)("%s truncates the host", (rel) => {
    // The bar is the only place in these files where a `.host` value is
    // rendered into a span of its own, so pinning the class on that span is
    // enough without parsing the JSX.
    const src = read(rel);
    const bar = src.match(
      /<span\s+className="([^"]*font-mono[^"]*uppercase[^"]*)"/,
    );
    expect(bar, `no host bar span found in ${rel}`).not.toBeNull();
    expect(bar![1]).toContain("truncate");
  });
});

describe("no h-screen where mobile browser chrome would cut content", () => {
  it("app/ uses min-h-screen or 100dvh, never a bare h-screen", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), {
        withFileTypes: true,
      })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (entry.name.endsWith(".tsx")) {
          // `min-h-screen` only sets a floor, so the page still scrolls and
          // the chrome costs nothing. `h-screen` pins the box to the LARGE
          // viewport, which on iOS Safari is taller than what is visible.
          if (/(?<!min-)\bh-screen\b/.test(code(rel))) offenders.push(rel);
        }
      }
    };
    walk("app");
    expect(offenders).toEqual([]);
  });
});

/**
 * `truncate` is right for unbounded user data in a constrained slot: a URL, an
 * email, a hostname, a team name. Clipping those is a deliberate trade and the
 * full value is reachable somewhere else.
 *
 * It is wrong for a label the developer wrote. The string is known, short and
 * load-bearing, so the container could simply have been sized to fit it, and
 * an ellipsis on "SESSIONS" or "Software inventory" destroys meaning and buys
 * nothing. Every entry below was a live clip on a 320-390px screen or one
 * rename away from becoming one, and every one of them is invisible on a
 * desktop browser, which is the whole reason this file exists.
 *
 * The label is matched only where it is the element's own text child, so a
 * label that also appears inside some other expression (screenshot-panel's
 * `{captured ?? "Page screenshot"}`, where the truncate belongs to a
 * timestamp) does not count against it.
 */
const FIXED_LABELS: [rel: string, label: string][] = [
  // One header for every admin panel, so this one is worth ~20 tabs.
  ["components/admin/shared/panel-header.tsx", "{title}"],
  ["components/admin/features/health-overview.tsx", "System Health"],
  ["components/admin/shared/admin-mobile-toc.tsx", "{item.label}"],
  ["components/scanner/panel-refresh.tsx", "{title}"],
  ["components/scanner/screenshot-panel.tsx", "Page screenshot"],
  ["components/scanner/software-inventory-panel.tsx", "Software inventory"],
  ["components/scanner/threat-intel-panel.tsx", "Threat intelligence"],
  ["components/shared/command-palette.tsx", "{entry.label}"],
  ["components/shared/tour/tour-callout.tsx", "{chapterLabel}"],
  ["components/landing/landing-sample-finding.tsx", "{value}"],
  ["components/modals/discord-profile-modal.tsx", "Use Discord avatar"],
  ["components/modals/github-profile-modal.tsx", "Use GitHub avatar"],
  // A check title comes out of the static catalogue, not from a user.
  ["app/checks/page.tsx", "{c.title}"],
  ["app/checks/[id]/page.tsx", "{c.title}"],
  // An OpenAPI route, the only thing telling two endpoint rows apart.
  ["app/docs/api/playground/page.tsx", "{op.path}"],
  ["app/docs/rate-limits/page.tsx", "{plan.plan}"],
  ["app/tools/link-checker/page.tsx", "{f.label}"],
  ["app/dev/modals/workbench.tsx", "{specimen.name}"],
  ["app/dev/modals/workbench.tsx", "{entry.name}"],
];

/**
 * The opening tags of every element whose own text child is `label`. Comments
 * are stripped first: several of these files explain the clip they used to
 * have in a comment that names the class, and matching the prose would let a
 * regression pass on its own documentation.
 */
function tagsRendering(rel: string, label: string): string[] {
  const src = code(rel);
  const tags: string[] = [];
  for (
    let at = src.indexOf(label);
    at !== -1;
    at = src.indexOf(label, at + 1)
  ) {
    const before = src.slice(0, at).trimEnd();
    // `>` means the label is this element's text. Anything else means the
    // label is embedded in an expression (a key, a template literal, a
    // fallback) and the surrounding element is not "the label's container".
    if (!before.endsWith(">")) continue;
    const open = before.lastIndexOf("<");
    if (open !== -1) tags.push(before.slice(open));
  }
  return tags;
}

describe("a label the developer wrote is never truncated", () => {
  it.each(FIXED_LABELS)("%s does not clip %s", (rel, label) => {
    const tags = tagsRendering(rel, label);
    // Guards the assertion against going vacuous on a rename.
    expect(
      tags.length,
      `no element renders ${label} in ${rel}`,
    ).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag, `${rel} clips the fixed label ${label}`).not.toContain(
        "truncate",
      );
    }
  });
});

/**
 * Stat cells sized to fit the caption they were given.
 *
 * Both of these strips laid their cells out as `flex-1 basis-24`. 96px minus
 * the cell padding is a ~68px content box, and a 10px uppercase caption with
 * tracking-wider needs about 67px for "SESSIONS" or "CONFIDENCE", so four
 * cells across a 390px phone clipped to "SESSIO...". The floor is half the row
 * below sm, which puts two cells per line and gives every caption room.
 */
describe("stat strips give their captions room", () => {
  it.each([
    "components/shared/stat-strip.tsx",
    "components/scanner/scan-summary.tsx",
  ])("%s does not lay cells out at basis-24", (rel) => {
    const src = code(rel);
    expect(src).toContain("basis-[calc(50%-1px)]");
    // Unprefixed only. `sm:basis-24` is the step back up once the row is wide
    // enough to hold four cells; it is the phone-width floor that was wrong.
    expect(src).not.toMatch(/(?<![:-])basis-24\b/);
  });
});

/**
 * Rows that hold a long value next to controls that cannot shrink. Left as a
 * flat `flex-row` at every width, the shrink-0 side takes what it needs and
 * the value gets whatever is left, which on a 320px screen was routinely under
 * 100px. Each of these either stacks below sm or wraps.
 *
 * Two shapes, and which one is right depends on whether the row opens with a
 * glyph. `sm:flex-row` on the row is fine when the first child is the value
 * itself; where an icon leads, stacking the row would leave that icon alone on
 * a line of its own, so the CONTROL GROUP takes `w-full sm:w-auto` inside a
 * wrapping row instead and the icon stays with the value it belongs to.
 */
const STACKING_ROWS: [rel: string, marker: string][] = [
  ["components/profile/tabs/developer/domains-section.tsx", "sm:w-auto"],
  ["components/profile/tabs/developer/webhooks-section.tsx", "sm:w-auto"],
  ["components/admin/features/blocked-data-manager.tsx", "sm:w-auto"],
  ["components/admin/features/backup-manager.tsx", "sm:flex-row"],
  ["components/admin/features/billing-overview-manager.tsx", "sm:flex-row"],
  ["components/admin/staff/staff-list.tsx", "sm:flex-row"],
  ["components/admin/shared/panel-header.tsx", "sm:flex-row"],
  ["components/scanner/share-modal.tsx", "sm:flex-row"],
  ["components/admin/features/email-logs-manager.tsx", "basis-full sm:basis-0"],
  ["components/repos/repo-detail.tsx", "flex flex-wrap items-center gap-3"],
  ["components/scanner/software-inventory-panel.tsx", "flex-wrap"],
  ["components/scanner/threat-intel-panel.tsx", "flex-wrap"],
];

describe("value-plus-control rows stack or wrap on a phone", () => {
  it.each(STACKING_ROWS)("%s carries %s", (rel, marker) => {
    expect(code(rel)).toContain(marker);
  });
});

/**
 * An opaque identifier is one unbreakable token. Without a break opportunity
 * it sets its container's minimum width and pushes the page into a horizontal
 * scroll, which on a phone is the most obvious kind of broken there is.
 */
describe("opaque identifiers can break", () => {
  it.each([
    "components/admin/staff/staff-list.tsx",
    "components/admin/audit/audit-log.tsx",
    "components/admin/notifications/notifications-manager.tsx",
    "components/admin/features/updater-manager.tsx",
    "app/admin/ai-chats/[id]/page.tsx",
  ])("%s breaks its ids", (rel) => {
    expect(code(rel)).toContain("break-all");
  });
});

/**
 * Icon-only controls at the app's touch-target floor. The house pattern is
 * `h-11 w-11 sm:h-9 sm:w-9` (components/scanner/footer.tsx), i.e. 44px on a
 * phone stepping back down to the desktop size from sm.
 *
 * Not everything small is listed. components/shared/inline-alert.tsx,
 * components/shared/site-notifications.tsx's toast dismiss and
 * scan-summary.tsx's SSL explainer each sit inline with body text and each
 * carries a comment recording a deliberate move to the 24x24 SC 2.5.8 floor;
 * growing those to 44 would push the text around them. These are the controls
 * that stand alone and had no such reason.
 */
describe("icon-only controls clear 44px on a phone", () => {
  it.each([
    // The only route to the notification panel on a phone.
    "components/shared/notification-center.tsx",
    // The only way to stop a running tour.
    "components/shared/tour/tour-callout.tsx",
    "components/admin/notifications/notifications-manager.tsx",
    "components/admin/teams/teams-list.tsx",
    "components/admin/features/ip-rules-manager.tsx",
    "components/admin/features/mass-email-manager.tsx",
    "components/admin/features/security-alerts-manager.tsx",
    "components/admin/features/system-settings-manager.tsx",
    "components/profile/tabs/developer/domains-section.tsx",
    "components/profile/tabs/developer/webhooks-section.tsx",
    "components/profile/tabs/developer/schedules-section.tsx",
    "components/repos/repo-detail.tsx",
  ])("%s steps its icon buttons down from h-11 w-11", (rel) => {
    // Two separate contains rather than one regex: the two halves are not
    // always adjacent in the class string (a shrink-0 or a colour token often
    // sits between them, and cn() splits some of these across lines).
    const src = code(rel);
    expect(src).toContain("h-11 w-11");
    expect(src).toMatch(/sm:h-\d+ sm:w-\d+/);
  });
});

describe("the AI chat markdown renderer cannot widen the panel", () => {
  const src = read("components/ai-chat/message-content.tsx");

  it("wraps markdown tables in a horizontal scroller", () => {
    // A table cell will not shrink below its own min-content width, so w-full
    // alone does not hold a table inside a phone-width bubble.
    expect(src).toMatch(/overflow-x-auto[\s\S]{0,120}<table/);
  });

  it("breaks long links and inline code, but never mid-token", () => {
    // wrap-break-word (overflow-wrap: break-word), not break-all. Both stop a
    // long token from setting the bubble's min width, but break-all takes a
    // break opportunity at ANY character, which split short commands to fill
    // the line above them: the greeting's `/changelog` chip rendered as "/cha"
    // then "ngelog", unreadable and impossible to copy. overflow-wrap only
    // breaks a token that will not fit on a line by itself, so a command, a
    // header name or a config key moves down whole instead.
    expect(src).toMatch(/<a\s+className="wrap-break-word/);
    expect(src).toMatch(/<code\s+className="[^"]*wrap-break-word/);
    // Only in a className, so the comment explaining why break-all is wrong
    // does not itself fail this.
    expect(src).not.toMatch(/className="[^"]*break-all/);
  });
});
