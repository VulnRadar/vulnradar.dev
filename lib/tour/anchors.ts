/**
 * Every element the product tour is allowed to point at, in one place.
 *
 * The tour is a coach mark: it draws a hole in a scrim over a real control and
 * anchors a tooltip beside it. That only works if the control can be found, and
 * the failure mode of finding it by a CSS selector written inline in the step
 * list is silent. A renamed class, a refactored wrapper, a component that moved
 * behind a Popover: the selector still parses, `querySelector` still returns
 * null, and the step degrades to a card in the middle of the screen that says
 * "click the Scan button" while pointing at nothing. Nothing fails loudly.
 *
 * So anchors are declared here as a closed set. A step references a KEY of this
 * object, which makes a rename a type error rather than a dead selector, and
 * tests/lib/tour/anchors.test.ts asserts that every VALUE in it actually
 * appears as `data-tour="..."` somewhere under app/ or components/. Between the
 * two, an anchor cannot drift out of the product without something going red.
 *
 * The values are what land in the DOM. They are kebab-case and stable: they are
 * effectively a public contract with the markup, so renaming one means editing
 * the element too, which is exactly the friction we want.
 */
export const TOUR_ANCHORS = {
  // Header nav. Rendered twice (a desktop `hidden lg:flex` nav and a mobile
  // Sheet), so both copies carry the same attribute and the resolver picks
  // whichever one is actually visible. See resolveAnchor().
  navHistory: "nav-history",
  navCompare: "nav-compare",
  navShares: "nav-shares",
  navTeams: "nav-teams",
  navProfile: "nav-profile",

  // The scan console.
  scanModes: "scan-modes",
  scanUrlInput: "scan-url-input",
  scanFamilies: "scan-families",
  scanPrivacy: "scan-privacy",
  scanSubmit: "scan-submit",
  scanProgress: "scan-progress",

  // The gate between a finished scan and its report. It is a real modal with
  // its own scrim, and it opens in the same commit that mounts the verdict, so
  // a tour that does not know about it spotlights a card the modal is sitting
  // on top of. The anchor is the modal PANEL, not one of its buttons: the step
  // asks the reader to read the choice, and a hole cut around a single button
  // would leave the rest of the dialog under the tour's own scrim.
  aiChoiceModal: "ai-choice-modal",

  // A finished scan.
  scanVerdict: "scan-verdict",
  scanReadouts: "scan-readouts",
  scanSeverity: "scan-severity",
  scanTags: "scan-tags",
  scanActions: "scan-actions",
  findingSearch: "finding-search",
  findingRow: "finding-row",
  findingDetail: "finding-detail",
  findingEvidence: "finding-evidence",
  findingFix: "finding-fix",
  findingTriage: "finding-triage",

  // History.
  historyTabs: "history-tabs",
  historySearch: "history-search",
  historyRow: "history-row",
  historyTags: "history-tags",

  // Compare. compareHostRow is on every row of the host list rather than on
  // the panel around it, because the panel renders whether or not there is
  // anything in it: an account with nothing to diff would otherwise sit on a
  // step telling it to click a host that does not exist.
  compareHosts: "compare-hosts",
  compareHostRow: "compare-host-row",
  // The whole pick-two-scans block, including the Compare button inside it.
  // There was a separate anchor on that button and it had to go: the scrim
  // blocks every click outside the spotlight, so highlighting the button alone
  // put the scan checkboxes it depends on out of the reader's reach.
  comparePicker: "compare-picker",
  compareDiff: "compare-diff",

  // Teams.
  teamsList: "teams-list",

  // The AI assistant. Its launcher is fixed to the corner of every page, so
  // unlike everything else on this list it is not somewhere the tour has to
  // navigate to: it is already there, which is exactly why it needed
  // explaining rather than hiding. See lib/tour/tour-chrome.ts.
  chatLauncher: "chat-launcher",
  chatPanel: "chat-panel",
  chatComposer: "chat-composer",
  chatCommands: "chat-commands",

  // Profile, which is also where the developer surfaces live. Only the tab
  // rail and the content column are anchored: the panels inside it belong to
  // components/profile, and a wrapper there would be a second owner for the
  // same markup. The steps name the sub-tab in their copy and follow the
  // `?dtab=` param instead, which is what the user is clicking anyway.
  profileTabs: "profile-tabs",
  profilePanel: "profile-panel",
} as const;

export type TourAnchor = keyof typeof TOUR_ANCHORS;

/**
 * Spread onto the element you want the tour to be able to point at:
 *
 *   <Button {...tourAnchor("scanSubmit")}>Scan</Button>
 *
 * Preferred over writing `data-tour="scan-submit"` by hand, because the string
 * form compiles whether or not the anchor is declared and the helper does not.
 */
export function tourAnchor(name: TourAnchor): { "data-tour": string } {
  return { "data-tour": TOUR_ANCHORS[name] };
}

/**
 * Finds the live element for an anchor, or null.
 *
 * "Visible" is doing real work here, not defensiveness. Several anchors are
 * rendered more than once by design: the header nav exists as a desktop row
 * and again inside a mobile Sheet, and a `display: none` copy still matches
 * `querySelector` and still reports a 0x0 rect. Spotlighting that copy draws a
 * hole with no width in the top-left corner. Picking the first match with a
 * non-empty box means the same anchor name works on both layouts without the
 * step list knowing which one is on screen.
 */
export function resolveAnchor(name: TourAnchor): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const nodes = document.querySelectorAll<HTMLElement>(
    `[data-tour="${TOUR_ANCHORS[name]}"]`,
  );
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return node;
  }
  return null;
}
