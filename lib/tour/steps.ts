import {
  AI_BOT_NAME,
  AI_CHAT_HISTORY_DAYS,
  ALL_API_KEY_SCOPES,
  ROUTES,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/client-constants";
import { SLASH_COMMANDS } from "@/lib/ai/commands";
import type { TourAnchor } from "./anchors";
import type { TourPlacement } from "./placement";

/**
 * The product tour, as data.
 *
 * This file replaced eight slides of prose that could be read with the app
 * closed. Every step below either points at a control that exists in the DOM or
 * asks the user to do something real, and the ones that ask wait for it to
 * happen rather than counting down. The rule for adding one: if the step would
 * still make sense as a sentence in the docs, it does not belong here. A tour
 * step earns its place by saying something the label on the control does not.
 *
 * No JSX and no React import, on purpose. tests/lib/tour/steps.test.ts reads
 * this in a plain node environment to check every anchor against the source
 * tree, and a component import would drag a DOM into that test for nothing.
 * Interpolation is fine and preferred: a number typed into a sentence here
 * (how many checks, how many scopes, what a plan includes) is a fact that goes
 * stale silently, so it comes from the same constant the product reads.
 */

/** What makes a step finish. */
export type TourAdvance =
  /** Passive. The reader presses Next when they have read it. */
  | { kind: "next" }
  /**
   * Waits for a real click on the anchor, captured at the document root.
   *
   * No step uses this today, and the reason is worth keeping: a click advance
   * fires when the button is PRESSED, not when pressing it worked. Both steps
   * that used to be one (press Scan, press Compare) handed over to a step
   * whose anchor only exists if the press succeeded, so a rejected submit or a
   * failed request left the tour waiting on something that was never coming.
   * Both are `appear` advances on the thing the press produces now. Only reach
   * for this when the click itself is the whole point and no later step
   * depends on what it produced.
   */
  | { kind: "click"; on: TourAnchor }
  /** Waits for the anchor's value to reach `minLength` characters. */
  | { kind: "input"; on: TourAnchor; minLength: number }
  /** Waits for an element that does not exist yet to mount. */
  | { kind: "appear"; of: TourAnchor }
  /**
   * Waits for an element that is on the page now to go away.
   *
   * The mirror of `appear`, and it exists because the app puts things IN FRONT
   * of what a step wants to talk about. A scan finishing mounts the verdict
   * card and opens the AI choice dialog in the same commit, so a tour that
   * only knows how to wait for things to arrive spotlights the verdict from
   * underneath a modal that is covering it. A step that blocks until the modal
   * is gone is the honest description of what the reader is looking at.
   *
   * "Gone" means the anchor does not resolve, which is also true when it never
   * mounted at all. That is deliberate: pair this with `optional` and a step
   * about a dialog that this account never sees costs one frame instead of
   * stalling the tour on a condition nothing will ever satisfy.
   */
  | { kind: "disappear"; of: TourAnchor }
  /** Waits for the location to match `to`. Path plus every declared param. */
  | { kind: "route"; to: string };

export interface TourStep {
  /** Stable across releases: it is what gets persisted mid-tour. */
  id: string;
  chapter: TourChapterId;
  /**
   * Where the step lives. Used for the "Take me there" button on the degraded
   * card, and it is what a route advance is compared against. A query string
   * here is a requirement, not a suggestion: "/profile?tab=developer" matches
   * only when that param is actually set.
   */
  route: string;
  /** The element to cut out of the scrim. Omitted for a step with no target. */
  anchor?: TourAnchor;
  title: string;
  body: string;
  /** Preferred side for the callout. Falls back to whichever side fits. */
  placement?: TourPlacement;
  advance: TourAdvance;
  /**
   * What the callout says while the step is waiting. A generic line per
   * advance kind is the fallback and it is nearly always worse: "waiting for
   * it to show up" tells a reader nothing, where "waiting for the scan to
   * finish" tells them the tour knows what is happening and roughly how long
   * it will take.
   */
  waitLabel?: string;
  /**
   * True when the anchor genuinely may not exist for this account, and its
   * absence means the step does not apply rather than that something broke: a
   * findings list with no code example, a compare page for someone who has
   * scanned one host once. An optional step whose anchor never resolves is
   * skipped silently instead of degrading to a card about a control the reader
   * cannot see.
   */
  optional?: boolean;
  /**
   * True when this step is ABOUT the app's own floating chrome, which today
   * means the AI assistant's launcher and panel.
   *
   * The tour hides that chrome for every other step: a filled brand-coloured
   * circle fixed to the corner of the viewport, glowing through the scrim
   * beside a callout that is pointing at something else, reads as a rendering
   * fault rather than as a control. Setting this lifts the suppression so the
   * step can point at it. See lib/tour/tour-chrome.ts.
   */
  usesFloatingChrome?: boolean;
}

export type TourChapterId =
  | "scan"
  | "verdict"
  | "finding"
  | "history"
  | "compare"
  | "automate"
  | "team"
  | "assistant"
  | "end";

export interface TourChapter {
  id: TourChapterId;
  /** Shown above the step title, and on the progress rail. */
  label: string;
}

/**
 * Chapters exist so the progress indicator is not twenty-six identical dots.
 * The rail draws one segment per chapter, each sized to the number of steps in
 * it, so its widths carry real information: the reader can see that the
 * scanning chapter is a third of the tour and the team chapter is two steps.
 */
export const TOUR_CHAPTERS: readonly TourChapter[] = [
  { id: "scan", label: "Run one" },
  { id: "verdict", label: "Read it" },
  { id: "finding", label: "One finding" },
  { id: "history", label: "History" },
  { id: "compare", label: "Compare" },
  { id: "automate", label: "Automate" },
  { id: "team", label: "Team" },
  { id: "assistant", label: "Ask it" },
  { id: "end", label: "Done" },
];

const PROFILE_DEVELOPER = `${ROUTES.PROFILE}?tab=developer`;

/**
 * The scopes an API key can carry, read from the table the key form itself
 * renders rather than typed out. Three today; the sentence stays true if that
 * changes, which a hand-written list would not.
 */
const API_KEY_SCOPE_LIST = ALL_API_KEY_SCOPES.join(", ");

/**
 * A few slash commands to name in the copy, taken off the front of the same
 * table the autocomplete renders.
 *
 * The head of the list rather than a hand-picked set: lib/ai/commands.ts is
 * ordered with the context loaders first, which is exactly what the step is
 * describing, and taking a slice means a renamed or reordered command changes
 * this sentence instead of contradicting it.
 */
const SLASH_EXAMPLES = SLASH_COMMANDS.slice(0, 3)
  .map((c) => `/${c.cmd}`)
  .join(", ");

/** How many the autocomplete has to offer, so the copy never miscounts. */
const SLASH_COMMAND_COUNT = SLASH_COMMANDS.length;

export const TOUR_STEPS: readonly TourStep[] = [
  // Chapter 1: run a real scan.
  {
    id: "welcome",
    chapter: "scan",
    route: ROUTES.DASHBOARD,
    title: "You click, the tour follows",
    body: "Nothing here is a screenshot. The control it highlights is the real one, and a step that asks you to do something waits until you actually do it. End tour, bottom right, stops the whole thing for good. The pause button in the corner puts it down and leaves a resume pill, and so does Escape.",
    advance: { kind: "next" },
  },
  {
    id: "scan-modes",
    chapter: "scan",
    route: ROUTES.DASHBOARD,
    anchor: "scanModes",
    title: "Pick how it reaches the target",
    body: "Quick reads the one URL you give it. Deep crawls the site first and hands you the page list to pick from. Bulk takes one URL per line. Stay on Quick for the tour.",
    placement: "bottom",
    advance: { kind: "next" },
  },
  {
    id: "scan-url",
    chapter: "scan",
    route: ROUTES.DASHBOARD,
    anchor: "scanUrlInput",
    title: "Type a host you are allowed to scan",
    body: "A bare domain is enough: example.com. The requests come from our servers against the live response, not from your browser, so pick something you own or have written permission to test.",
    placement: "bottom",
    advance: { kind: "input", on: "scanUrlInput", minLength: 4 },
    waitLabel: "Waiting for a host in the box.",
  },
  {
    id: "scan-families",
    chapter: "scan",
    route: ROUTES.DASHBOARD,
    anchor: "scanFamilies",
    title: `${TOTAL_CHECKS_LABEL} checks, sorted into families`,
    body: "Turning a family off skips its checks and shortens the run. The button reads enabled over total, so you can see at a glance that something has been switched off. Leave it alone for a first scan: the default is all of them.",
    placement: "bottom",
    advance: { kind: "next" },
  },
  {
    id: "scan-privacy",
    chapter: "scan",
    route: ROUTES.DASHBOARD,
    anchor: "scanPrivacy",
    title: "Private scans skip the public host page",
    body: "Left off, the findings also land on the public page for that hostname. Switched on, the scan stays inside your account. It starts from your account default, which lives under Profile, Privacy.",
    placement: "bottom",
    advance: { kind: "next" },
  },
  {
    id: "scan-submit",
    chapter: "scan",
    route: ROUTES.DASHBOARD,
    anchor: "scanSubmit",
    title: "Now press Scan",
    body: "This is a real run against a real host. It usually takes a few seconds on Quick. If the address does not pass validation the form says so and nothing starts, so fix it and press again.",
    placement: "top",
    // The scan starting, not the button being pressed. A click advance fires
    // even when the submit is rejected (a malformed host, a blocked target),
    // and the next step then waits for a progress panel that no run is going
    // to mount. Waiting for the panel keeps a rejected submit on this step,
    // where the reader can see the form's own error and try again.
    advance: { kind: "appear", of: "scanProgress" },
    waitLabel: "Waiting for you to press Scan.",
  },
  {
    id: "scan-progress",
    chapter: "scan",
    route: ROUTES.DASHBOARD,
    anchor: "scanProgress",
    title: "It reports family by family",
    body: "The checklist is the actual progress, not a bar guessing at one: each family ticks over as its checks come back. Cancel stops the job server-side, not just the display.",
    placement: "bottom",
    advance: { kind: "appear", of: "scanVerdict" },
    waitLabel: "Waiting for the scan to finish.",
  },

  // Chapter 2: read what came back.
  //
  // Ordered by where things are on the page, not by when they were built. The
  // results view renders the action row, then the verdict and its readouts,
  // then the host panels with the tag card at their foot, then the findings
  // list with its search box above its severity strip. The one deliberate
  // deviation is the action row: it is physically first but the reader has to
  // be shown the result before being shown what to do with it, so it sits
  // after the readouts and costs one short scroll back up.
  //
  // An earlier cut walked severity before search, tags before actions and
  // actions last, which meant the chapter ran to the foot of the page, jumped
  // to the very top, and came back down to the middle to open a finding. Three
  // reversals, each of them a several-hundred-pixel smooth scroll with the
  // callout chasing it.
  {
    id: "ai-choice",
    chapter: "verdict",
    route: ROUTES.DASHBOARD,
    anchor: "aiChoiceModal",
    title: "One question before the report",
    body: "The report is already rendered behind this. Verifying re-probes each finding against the live site and marks it confirmed, likely a false positive, or unverified, and it spends AI allowance from your account. Skipping goes straight to the raw findings and spends nothing. Neither answer is the right one for the tour: it carries on as soon as this is closed.",
    placement: "right",
    // Optional because this dialog is conditional at both ends: the account
    // has to have AI configured and enabled, and the scan has to have been
    // saved to history. When it does not open, "gone" is true on the first
    // frame and the step costs nothing.
    optional: true,
    // Whichever way it is closed. There are three exits (verify, skip, the
    // close chip) and a click advance on any one of them strands the reader
    // who took a different one.
    advance: { kind: "disappear", of: "aiChoiceModal" },
    waitLabel: "Waiting for you to answer this, either way.",
  },
  {
    id: "verdict",
    chapter: "verdict",
    route: ROUTES.DASHBOARD,
    anchor: "scanVerdict",
    title: "The verdict is the worst thing found",
    body: "Not an average and not a count. One critical outranks twenty lows, because that is the one that decides whether this deploys. The glyph beside it repeats the verdict so the three still separate without colour.",
    placement: "bottom",
    advance: { kind: "next" },
  },
  {
    id: "verdict-readouts",
    chapter: "verdict",
    route: ROUTES.DASHBOARD,
    anchor: "scanReadouts",
    title: "Checks run is the one people miss",
    body: "Risk score and duration are the two everyone reads. Checks run is how much of the engine actually got to fire, and it is what tells you a clean-looking result was really a partial run that timed out.",
    placement: "top",
    advance: { kind: "next" },
  },
  {
    id: "scan-actions",
    chapter: "verdict",
    route: ROUTES.DASHBOARD,
    anchor: "scanActions",
    title: "Share, export, run it again",
    body: "The menu next to New scan is everything you can do with the whole scan rather than with one finding: hand it to someone on a revocable link, take it out of the app in whichever export formats are available to you, or run this exact configuration again instead of filling the form in twice.",
    placement: "bottom",
    advance: { kind: "next" },
  },
  {
    id: "scan-tags",
    chapter: "verdict",
    route: ROUTES.DASHBOARD,
    anchor: "scanTags",
    title: "Tag it now, find it later",
    body: "A tag like production or staging sticks to the scan and survives a rescan, so the next run of the same URL lands in the same filter instead of at the top of an undifferentiated list.",
    placement: "top",
    optional: true,
    advance: { kind: "next" },
  },
  {
    id: "finding-search",
    chapter: "verdict",
    route: ROUTES.DASHBOARD,
    anchor: "findingSearch",
    title: "This box takes a check ID",
    body: "Paste an ID out of a CI log or a shared report and you land on that finding. Plain words work too: they match the title, the category and the check ID at once.",
    placement: "bottom",
    advance: { kind: "next" },
  },
  {
    id: "severity-filter",
    chapter: "verdict",
    route: ROUTES.DASHBOARD,
    anchor: "scanSeverity",
    title: "The severity strip is a filter",
    body: "It reads as a legend, but every band is a button. Click one to show only that severity, click it again to put the rest back.",
    placement: "bottom",
    advance: { kind: "next" },
  },

  // Chapter 3: one finding, all the way down. Same rule as chapter 2: this is
  // the order the detail view renders in. Evidence, then the two cards that
  // ask what you think of the finding, then the worked example near the foot.
  {
    id: "open-finding",
    chapter: "finding",
    route: ROUTES.DASHBOARD,
    anchor: "findingRow",
    title: "Open a finding",
    // "The highlighted one", not "any row": the scrim blocks clicks outside
    // the spotlight, so the row in the hole is the only one that opens.
    body: "Open the highlighted one. Every finding is built the same way: what fired, the bytes it fired on, why it matters, and the config to change.",
    placement: "right",
    // Optional, and this one is load bearing rather than defensive. A clean
    // scan is a real and good outcome, and it renders no finding rows at all:
    // without this the tour would sit on "click any row" over an empty list,
    // with nothing the reader could do to satisfy it. No rows means no anchor,
    // which resolves the step and the three after it (all optional, all inside
    // the detail view) straight through to History.
    optional: true,
    advance: { kind: "appear", of: "findingDetail" },
    waitLabel: "Waiting for a finding to open.",
  },
  {
    id: "finding-evidence",
    chapter: "finding",
    route: ROUTES.DASHBOARD,
    anchor: "findingEvidence",
    title: "What the scanner saw",
    body: "The actual response lines the check matched on. If you think a finding is wrong, this is the thing to argue with, and it is what makes that argument short.",
    placement: "top",
    optional: true,
    advance: { kind: "next" },
  },
  {
    id: "finding-triage",
    chapter: "finding",
    route: ROUTES.DASHBOARD,
    anchor: "findingTriage",
    title: "Call a false positive a false positive",
    body: "Marking one takes it out of this scan's count and feeds the engine's own accuracy tracking, so the check gets tightened rather than ignored. Not applicable is the option beside it: real, but not yours to fix.",
    placement: "top",
    optional: true,
    advance: { kind: "next" },
  },
  {
    id: "finding-fix",
    chapter: "finding",
    route: ROUTES.DASHBOARD,
    anchor: "findingFix",
    title: "A snippet, not an explanation",
    body: "Config for the server you are actually running. Where a finding has more than one worked example, the buttons above the block switch between them. Copy takes the whole thing. Nothing here asks you to go and read a spec first.",
    placement: "top",
    optional: true,
    advance: { kind: "next" },
  },

  // Chapter 4: history.
  {
    id: "go-history",
    chapter: "history",
    route: ROUTES.DASHBOARD,
    anchor: "navHistory",
    title: "Open History",
    body: "Click it in the nav. Nothing is thrown away: every scan this account has ever run is in there, including the ones that failed.",
    placement: "bottom",
    advance: { kind: "route", to: ROUTES.HISTORY },
    waitLabel: "Waiting for you to open History.",
  },
  {
    id: "history-tabs",
    chapter: "history",
    route: ROUTES.HISTORY,
    anchor: "historyTabs",
    title: "Several views over the same scans",
    body: "My History is one row per run. Assets is one row per host you have ever touched. Attack Surface is the same thing narrowed to domains you have verified. Public Scans is what other people chose to publish.",
    placement: "bottom",
    advance: { kind: "next" },
  },
  {
    id: "history-search",
    chapter: "history",
    route: ROUTES.HISTORY,
    anchor: "historySearch",
    title: "Filter by URL",
    body: "Substring match against the scanned URL. The pickers beside it stack with this rather than replacing it, so a filter you set here survives sorting and narrowing by anything else.",
    placement: "bottom",
    advance: { kind: "next" },
  },
  {
    id: "history-row",
    chapter: "history",
    route: ROUTES.HISTORY,
    anchor: "historyRow",
    title: "A row opens the whole report",
    body: "Not a summary of it. The findings, the evidence and the fix snippets are all still there, which is why a scan from three months ago is still worth keeping.",
    placement: "bottom",
    optional: true,
    advance: { kind: "next" },
  },
  {
    id: "history-tags",
    chapter: "history",
    route: ROUTES.HISTORY,
    anchor: "historyTags",
    title: "Tags live on the row",
    body: "Add one here and it shows up in the tag filter straight away. This is the same tag you saw on the scan you just ran.",
    placement: "bottom",
    optional: true,
    advance: { kind: "next" },
  },

  // Chapter 5: compare.
  {
    id: "go-compare",
    chapter: "compare",
    route: ROUTES.HISTORY,
    anchor: "navCompare",
    title: "Open Compare",
    body: "This is the page that answers whether the fix actually landed. Click Compare.",
    placement: "bottom",
    advance: { kind: "route", to: ROUTES.COMPARE },
    waitLabel: "Waiting for you to open Compare.",
  },
  {
    id: "compare-hosts",
    chapter: "compare",
    route: ROUTES.COMPARE,
    anchor: "compareHosts",
    title: "Grouped by host, because a diff needs two runs of one thing",
    body: "Only hosts you have scanned more than once show up here with anything to diff. If this list is short, that is just how new the account is.",
    placement: "bottom",
    advance: { kind: "next" },
  },
  {
    // Anchored on a host ROW, not on the panel around the list. Two things
    // fall out of that and both were bugs.
    //
    // The panel renders whether or not there is anything in it, so an account
    // with nothing scanned twice used to sit here being told to click a host
    // that does not exist, with no way to satisfy the step. A row is the thing
    // that is genuinely absent in that case, so `optional` resolves it.
    //
    // And the advance is the row list GOING, not the scan picker arriving,
    // because clicking a host does not always open a picker: a host with
    // exactly two scans has no choice to offer, so app/compare/page.tsx runs
    // the diff immediately and jumps straight to the result. Waiting for the
    // picker stalled forever on exactly those hosts. The list disappearing is
    // true on both paths.
    id: "compare-pick",
    chapter: "compare",
    route: ROUTES.COMPARE,
    anchor: "compareHostRow",
    title: "Pick a host, then two of its runs",
    body: "Open the highlighted host. The older of the two scans you pick becomes the base automatically, so the diff always reads forwards in time. A host with exactly two scans has nothing to choose, so it goes straight to the result.",
    placement: "bottom",
    optional: true,
    advance: { kind: "disappear", of: "compareHostRow" },
    waitLabel: "Waiting for you to pick a host.",
  },
  {
    id: "compare-run",
    chapter: "compare",
    route: ROUTES.COMPARE,
    // The whole picker block, not the Compare button on its own. The scrim
    // swallows every click outside the spotlight, so a hole cut around the
    // button alone would leave the reader unable to tick the two scans that
    // button needs before it enables: an instruction that cannot be followed.
    // Whatever a step asks for has to be inside the hole.
    anchor: "comparePicker",
    title: "Run the diff",
    body: "Tick two of this host's scans, then press Compare. It compares finding IDs, not rendered text, so this is a set difference rather than a second read of both reports.",
    placement: "top",
    // Absent whenever the previous step went straight to a result, which is
    // the two-scan case. Nothing to press, nothing to explain.
    optional: true,
    // The diff, not the click. A click advance hands over the moment the
    // button is pressed, and the next step's anchor is the diff itself, which
    // does not exist until the request comes back: on a slow response that
    // step was skipped for a missing anchor before it ever had one.
    advance: { kind: "appear", of: "compareDiff" },
    waitLabel: "Waiting for you to press Compare.",
  },
  {
    id: "compare-diff",
    chapter: "compare",
    route: ROUTES.COMPARE,
    anchor: "compareDiff",
    title: "New, fixed, unchanged",
    body: "Finding IDs are stable between runs, so fixed means fixed rather than worded differently this time. Unchanged is the list nobody looks at and the one that quietly grows.",
    placement: "top",
    optional: true,
    advance: { kind: "next" },
  },

  // Chapter 6: the developer surfaces.
  {
    id: "go-profile",
    chapter: "automate",
    route: ROUTES.COMPARE,
    anchor: "navProfile",
    title: "Open Profile",
    body: "API keys, webhooks and scheduled scans all live under it. Click Profile.",
    placement: "bottom",
    advance: { kind: "route", to: ROUTES.PROFILE },
    waitLabel: "Waiting for you to open Profile.",
  },
  {
    id: "profile-developer",
    chapter: "automate",
    route: ROUTES.PROFILE,
    anchor: "profileTabs",
    title: "Open the Developer section",
    body: "In the tab rail, under Build with it. Everything that runs a scan without a person watching is behind it.",
    placement: "right",
    advance: { kind: "route", to: PROFILE_DEVELOPER },
    waitLabel: "Waiting for the Developer section.",
  },
  {
    id: "api-keys",
    chapter: "automate",
    route: PROFILE_DEVELOPER,
    anchor: "profilePanel",
    title: "One key, one POST",
    body: `Keys are scoped, and the scopes are granted separately: ${API_KEY_SCOPE_LIST}. The response is the same JSON this dashboard renders, which is enough to fail a build when a new high shows up.`,
    placement: "left",
    advance: { kind: "next" },
  },
  {
    id: "schedules",
    chapter: "automate",
    route: `${PROFILE_DEVELOPER}&dtab=schedules`,
    anchor: "profilePanel",
    title: "Open Scheduled scans",
    body: "The tabs across the top of this panel. Point a schedule at a URL, pick a frequency, and it runs without you and writes into the same history you just looked at.",
    placement: "left",
    advance: { kind: "route", to: `${PROFILE_DEVELOPER}&dtab=schedules` },
    waitLabel: "Waiting for the Scheduled scans tab.",
  },
  {
    id: "webhooks",
    chapter: "automate",
    route: `${PROFILE_DEVELOPER}&dtab=webhooks`,
    anchor: "profilePanel",
    title: "Now Webhooks",
    body: "Any endpoint that accepts JSON. Discord and Slack take the payload as it is. This is how a new finding reaches a channel instead of waiting for someone to open the app.",
    placement: "left",
    advance: { kind: "route", to: `${PROFILE_DEVELOPER}&dtab=webhooks` },
    waitLabel: "Waiting for the Webhooks tab.",
  },

  // Chapter 7: teams.
  {
    id: "go-teams",
    chapter: "team",
    route: PROFILE_DEVELOPER,
    anchor: "navTeams",
    title: "Open Teams",
    body: "Scanning alone is the easy case. Click Teams.",
    placement: "bottom",
    advance: { kind: "route", to: ROUTES.TEAMS },
    waitLabel: "Waiting for you to open Teams.",
  },
  {
    id: "teams-list",
    chapter: "team",
    route: ROUTES.TEAMS,
    anchor: "teamsList",
    title: "A team is a shared scan list with roles",
    body: "Create one, invite by email, and the role you give someone decides whether they can run a scan or only read one. Team scans land in one list rather than in whoever happened to run them. How many teams you can own depends on the plan, and the list says so.",
    placement: "top",
    // The list is only rendered while no team is open, and a plan without
    // teams has none to show. Either way its absence means the step does not
    // apply, not that the anchor broke.
    optional: true,
    advance: { kind: "next" },
  },

  // Chapter 8: the assistant.
  //
  // Every step here sets usesFloatingChrome, which is what lets the launcher
  // exist at all while the tour is running. It stays on /teams rather than
  // navigating anywhere, because the widget is fixed to the corner of every
  // page: the one surface in this product the tour does not have to go to.
  //
  // All four are optional, and for one reason each: the whole widget renders
  // null when AI is disabled for the deployment or the account, which takes
  // the launcher, the panel, the composer and the command list with it. So an
  // account without AI walks past this chapter without being shown a feature
  // it does not have.
  {
    id: "open-assistant",
    chapter: "assistant",
    route: ROUTES.TEAMS,
    anchor: "chatLauncher",
    title: `${AI_BOT_NAME} is on every page`,
    body: `That button in the corner is the assistant. It has been there the whole time and the tour has been hiding it, because a floating button on top of a coach mark is just clutter. Open it.`,
    placement: "left",
    optional: true,
    usesFloatingChrome: true,
    advance: { kind: "appear", of: "chatPanel" },
    waitLabel: "Waiting for the assistant to open.",
  },
  {
    id: "assistant-panel",
    chapter: "assistant",
    route: ROUTES.TEAMS,
    anchor: "chatPanel",
    title: "It answers about this product, not the internet",
    body: `Findings and how to fix them, the API, self-hosting, what changed in a release, and your own scan history. It is a support surface rather than a second scanner: ${AI_BOT_NAME} answers from context it has been given and says so when it has not been given enough. Transcripts are saved to your account, and the copy kept in this browser is dropped after ${AI_CHAT_HISTORY_DAYS} days.`,
    placement: "left",
    optional: true,
    usesFloatingChrome: true,
    advance: { kind: "next" },
  },
  {
    id: "assistant-slash",
    chapter: "assistant",
    route: ROUTES.TEAMS,
    anchor: "chatComposer",
    title: "Type a slash to load context",
    body: `It does not carry the whole product in its head. A slash command fetches a body of context on demand and hands it over for the next question: ${SLASH_EXAMPLES} and the rest, ${SLASH_COMMAND_COUNT} in all. Type / here.`,
    // Left, not top. The composer sits at the foot of the panel, so a callout
    // above it would be drawn over the conversation it is talking about.
    placement: "left",
    optional: true,
    usesFloatingChrome: true,
    advance: { kind: "appear", of: "chatCommands" },
    waitLabel: "Waiting for a slash in the box.",
  },
  {
    id: "assistant-commands",
    chapter: "assistant",
    route: ROUTES.TEAMS,
    anchor: "chatCommands",
    title: "The list filters as you type",
    body: "Arrow keys move the highlight, Enter takes the one that is highlighted. The ones about your own account are marked with a lock when you are signed out. Some take an argument, so a command can load one specific scan or one specific check rather than the whole index.",
    placement: "left",
    optional: true,
    usesFloatingChrome: true,
    advance: { kind: "next" },
  },

  // Chapter 9: the two things left, then out.
  {
    id: "shares",
    chapter: "end",
    route: ROUTES.TEAMS,
    anchor: "navShares",
    title: "Shared is every link you handed out",
    body: "A share link is revocable and can carry an expiry you set when you create it. If you have ever wondered what is still public, that page is the answer.",
    placement: "bottom",
    advance: { kind: "next" },
  },
  {
    id: "finish",
    chapter: "end",
    route: ROUTES.TEAMS,
    title: "That is the whole product",
    body: "You can replay this any time from Profile, General, Product tour, and it will pick up on whatever page you are on. Docs and the contact form are in the footer if something here did not land.",
    // Deliberately last and deliberately anchorless: this is where a run of
    // missing optional anchors comes to rest, so nobody can be skipped past
    // the end of the tour without being told it is over.
    advance: { kind: "next" },
  },
];

/** Index of the first step of each chapter, and how many steps it holds. */
export function chapterSpans(): {
  id: TourChapterId;
  start: number;
  size: number;
}[] {
  return TOUR_CHAPTERS.map((chapter) => {
    const start = TOUR_STEPS.findIndex((s) => s.chapter === chapter.id);
    const size = TOUR_STEPS.filter((s) => s.chapter === chapter.id).length;
    return { id: chapter.id, start, size };
  });
}

/**
 * Does the current location satisfy a step's declared route?
 *
 * Path equality plus every query param the route declares. Params the route
 * does not mention are ignored, so a step declaring "/profile?tab=developer"
 * still matches when the page has also written "?dtab=webhooks" of its own.
 * That asymmetry is deliberate: the route says what the step needs, not what
 * the URL is allowed to contain.
 */
export function matchesRoute(
  route: string,
  pathname: string,
  search: URLSearchParams,
): boolean {
  const [path, query] = route.split("?");
  if (path !== pathname) return false;
  if (!query) return true;
  const required = new URLSearchParams(query);
  for (const [key, value] of required) {
    if (search.get(key) !== value) return false;
  }
  return true;
}
