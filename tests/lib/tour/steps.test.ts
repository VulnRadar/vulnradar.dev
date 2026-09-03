/**
 * The product tour, held to its own contract.
 *
 * The tour points at real elements by `data-tour` attribute, and the failure
 * mode of that is silent: the attribute is deleted or renamed in a refactor,
 * `querySelector` returns null, and the step quietly degrades to a card in the
 * middle of the screen describing a control nobody can see. Nothing throws and
 * no test that renders a component notices, because the component that broke
 * and the component that cares are in different files.
 *
 * So these read the source tree, the same way
 * tests/components/ui/modal-grammar.test.ts does and for the same reason: what
 * is being checked is an agreement between two files, not the behaviour of
 * either one.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { AI_BOT_NAME } from "@/lib/config/client-constants";
import { TOUR_ANCHORS, type TourAnchor } from "@/lib/tour/anchors";
import {
  chapterSpans,
  matchesRoute,
  TOUR_CHAPTERS,
  TOUR_STEPS,
} from "@/lib/tour/steps";

const ROOT = process.cwd();
const SCAN_DIRS = ["components", "app"];

function sourceFiles(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".tsx") && !entry.endsWith(".ts")) continue;
      out.push({
        path: relative(ROOT, full).split(sep).join("/"),
        source: readFileSync(full, "utf8"),
      });
    }
  }
  for (const dir of SCAN_DIRS) walk(join(ROOT, dir));
  return out;
}

const FILES = sourceFiles();

/**
 * Where an anchor is placed in the tree.
 *
 * Three spellings count, and the third is the awkward one. `tourAnchor("x")`
 * is what a call site should write and `data-tour="x"` is the hand-written
 * form. But the header nav renders its links from a table, so the anchor name
 * is a value in that table and reaches `tourAnchor()` as a variable; there is
 * no literal call to find. So a file that imports the anchors module and names
 * the anchor as a bare string counts too. That is looser than the other two on
 * purpose: it is still a type-checked reference (the table is typed
 * `TourAnchor`), and the alternative is either no coverage for the nav or a
 * table of six near-identical JSX branches written out by hand.
 */
function placements(anchor: TourAnchor): string[] {
  const literal = `data-tour="${TOUR_ANCHORS[anchor]}"`;
  const helper = new RegExp(`tourAnchor\\(\\s*["']${anchor}["']\\s*\\)`);
  const named = new RegExp(`["']${anchor}["']`);
  return FILES.filter(
    ({ path, source }) =>
      source.includes(literal) ||
      helper.test(source) ||
      (path !== "lib/tour/anchors.ts" &&
        source.includes("@/lib/tour/anchors") &&
        named.test(source)),
  ).map((f) => f.path);
}

describe("every declared anchor exists in the product", () => {
  const names = Object.keys(TOUR_ANCHORS) as TourAnchor[];

  it.each(names)("%s is placed on a real element", (anchor) => {
    // This is the assertion the whole design rests on. An anchor declared here
    // and never placed is a step that will always degrade, and nothing else in
    // the suite would ever say so.
    expect(
      placements(anchor),
      `no element carries the ${anchor} anchor`,
    ).not.toHaveLength(0);
  });

  it("declares no anchor the steps never use", () => {
    const used = new Set<string>();
    for (const step of TOUR_STEPS) {
      if (step.anchor) used.add(step.anchor);
      const adv = step.advance;
      if (adv.kind === "click" || adv.kind === "input") used.add(adv.on);
      if (adv.kind === "appear" || adv.kind === "disappear") used.add(adv.of);
    }
    const orphans = names.filter((n) => !used.has(n));
    expect(orphans, "declared but never referenced by a step").toEqual([]);
  });
});

describe("the step list holds together", () => {
  it("has far more than the eight slides it replaced", () => {
    expect(TOUR_STEPS.length).toBeGreaterThan(24);
  });

  it("gives every step a unique id", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every step in a declared chapter, in chapter order", () => {
    const order = TOUR_CHAPTERS.map((c) => c.id);
    let seen = -1;
    for (const step of TOUR_STEPS) {
      const at = order.indexOf(step.chapter);
      expect(at, `${step.id} is in an undeclared chapter`).toBeGreaterThan(-1);
      // Chapters have to be contiguous: the progress rail computes how far
      // into a chapter you are from the step index alone, so a step filed out
      // of order would fill the wrong segment.
      expect(at, `${step.id} breaks chapter order`).toBeGreaterThanOrEqual(
        seen,
      );
      seen = at;
    }
  });

  it("leaves no chapter empty", () => {
    for (const span of chapterSpans()) {
      expect(span.size, `${span.id} has no steps`).toBeGreaterThan(0);
      expect(span.start).toBeGreaterThan(-1);
    }
  });

  it("lands a route advance on the page the next step lives on", () => {
    // A step that says "click History" and then hands over to a step that
    // lives on a different page would advance straight into a degrade.
    //
    // Pathname only, not the whole route: the three profile sub-tab steps each
    // navigate within /profile by changing ?dtab=, so the next step's query
    // string is legitimately different from the one just navigated to. What
    // has to hold is that its anchor is on the page we just landed on.
    for (const [i, step] of TOUR_STEPS.entries()) {
      if (step.advance.kind !== "route") continue;
      const next = TOUR_STEPS[i + 1];
      expect(next, `${step.id} navigates away on the last step`).toBeDefined();
      expect(
        next.route.split("?")[0],
        `${step.id} navigates to a page no step lives on`,
      ).toBe(step.advance.to.split("?")[0]);
    }
  });

  it("ends on a step with no anchor", () => {
    // The last step is where an unbroken run of missing optional anchors comes
    // to rest. If it had one, an account that matched none of them could skip
    // straight past the end and complete onboarding without being told.
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].anchor).toBeUndefined();
  });

  it("writes no em dash in any copy", () => {
    const offenders = TOUR_STEPS.filter(
      (s) => s.title.includes("—") || s.body.includes("—"),
    ).map((s) => s.id);
    expect(offenders).toEqual([]);
  });

  it("never hardcodes the check count", () => {
    // TOTAL_CHECKS_LABEL is configurable, and a number typed into the copy
    // goes stale the first time a check family is added. Checked against the
    // source rather than the evaluated steps, because by the time the constant
    // has been interpolated a correct step and a hardcoded one read the same.
    const source = readFileSync(join(ROOT, "lib/tour/steps.ts"), "utf8");
    expect(source).not.toMatch(/\b\d{3,}\+?\s*checks\b/i);
    expect(source).toContain("TOTAL_CHECKS_LABEL");
  });

  it("never hardcodes the API key scopes", () => {
    // Same argument as the check count, one level smaller. The scopes step
    // used to list scan:read, scan:write and scan:delete by hand, so a fourth
    // scope would have been described accurately everywhere in the product
    // except in the tour that teaches the feature.
    const source = readFileSync(join(ROOT, "lib/tour/steps.ts"), "utf8");
    expect(source).not.toMatch(/["'`][^"'`]*\bscan:(read|write|delete)\b/);
    expect(source).toContain("ALL_API_KEY_SCOPES");
  });

  it("states no count the copy would have to be edited to keep true", () => {
    // A number spelled out in a sentence about a list ("four views", "three
    // ways") is a hardcoded fact wearing words. Numbers that are part of what
    // is being explained rather than a count of something the product can grow
    // ("one URL per line") are fine, so this looks only for a small number
    // immediately in front of a plural noun.
    const offenders = TOUR_STEPS.filter((s) =>
      /\b(two|three|four|five|six|seven|eight|nine|ten)\s+(ways|views|tabs|options|sections|steps|slides|scopes|plans|tiers|families|modes|choices)\b/i.test(
        `${s.title} ${s.body}`,
      ),
    ).map((s) => s.id);
    expect(offenders).toEqual([]);
  });
});

describe("the post-scan AI dialog is part of the sequence", () => {
  // The bug this replaces: a scan finishing mounts the verdict card and opens
  // the AI choice dialog in the SAME commit, so a tour whose only tool was
  // "wait for the verdict to appear" advanced straight to a step that
  // spotlighted a card the dialog was sitting on top of, with the callout
  // overlapping the dialog. Order is the fix, and it only holds if all three
  // of these do.
  const at = (id: string) => TOUR_STEPS.findIndex((s) => s.id === id);

  it("sits between the running scan and the verdict", () => {
    const progress = at("scan-progress");
    const dialog = at("ai-choice");
    const verdict = at("verdict");
    expect(progress).toBeGreaterThan(-1);
    expect(dialog).toBeGreaterThan(-1);
    expect(verdict).toBeGreaterThan(-1);
    expect(dialog).toBe(progress + 1);
    expect(verdict).toBe(dialog + 1);
  });

  it("is optional, so an account that never sees the dialog is not stalled", () => {
    // The dialog needs AI enabled on the account and a scan saved to history.
    // Without `optional` a step waiting on something that will never mount is
    // a tour that stops here for everyone else.
    expect(TOUR_STEPS[at("ai-choice")].optional).toBe(true);
  });

  it("waits for the dialog to go rather than for a particular button", () => {
    // Three exits (verify, skip, the close chip). A click advance on any one
    // of them strands the reader who took a different one.
    expect(TOUR_STEPS[at("ai-choice")].advance).toEqual({
      kind: "disappear",
      of: "aiChoiceModal",
    });
  });

  it("does not hand over to the verdict step the moment the card mounts", () => {
    // The verdict card and the dialog are mounted in the same commit, so "the
    // verdict appeared" is a fine signal that the scan finished and a bad one
    // for "the reader can see the verdict". Anything watching for it has to
    // hand over to the dialog step, which then holds the verdict step back
    // until the dialog is gone.
    for (const [i, step] of TOUR_STEPS.entries()) {
      if (step.advance.kind !== "appear") continue;
      if (step.advance.of !== "scanVerdict") continue;
      expect(
        TOUR_STEPS[i + 1]?.id,
        `${step.id} advances into the verdict from under the dialog`,
      ).toBe("ai-choice");
    }
    expect(TOUR_STEPS[at("verdict")].anchor).toBe("scanVerdict");
  });

  it("does not push the reader toward the paid half of the choice", () => {
    const body = TOUR_STEPS[at("ai-choice")].body;
    // Verifying spends the account's AI allowance. A tour that tells someone
    // to press it is spending their money to demonstrate a feature.
    expect(body).not.toMatch(/\b(press|click|choose|pick|hit|tap)\s+verify/i);
    expect(body.toLowerCase()).toContain("skip");
  });
});

describe("no step waits on something that cannot arrive", () => {
  // The failure this catches is quiet and was real in the compare chapter: a
  // step whose anchor only exists AFTER the reader does the thing the step is
  // asking for. `optional` skips a missing anchor after a short grace window,
  // so such a step showed its instruction for two and a half seconds and then
  // deleted itself, taking the steps after it with it.
  it("anchors an instruction on something that is already on screen", () => {
    for (const [i, step] of TOUR_STEPS.entries()) {
      const adv = step.advance;
      if (adv.kind !== "appear") continue;
      expect(
        step.anchor,
        `${step.id} points at the very thing it is waiting to appear`,
      ).not.toBe(adv.of);
      // And the step it hands over to must be the one that anchor belongs to,
      // or the wait bought nothing.
      const next = TOUR_STEPS[i + 1];
      expect(next, `${step.id} waits on the last step`).toBeDefined();
    }
  });

  it("hands a disappear step over to a step on the same page", () => {
    for (const [i, step] of TOUR_STEPS.entries()) {
      if (step.advance.kind !== "disappear") continue;
      const next = TOUR_STEPS[i + 1];
      expect(next, `${step.id} waits on the last step`).toBeDefined();
      expect(next.route.split("?")[0]).toBe(step.route.split("?")[0]);
    }
  });
});

describe("a waiting step can always be satisfied or resolves itself", () => {
  // With the per-step skip gone (see "no user-facing skip" below), a step that
  // waits on a precondition the account cannot produce is a dead end, and the
  // only way past it is ending the tour. So every waiting step has to be one of
  // two things, deliberately, and this list is where that decision is recorded.
  //
  // Ids here are steps whose precondition is present for every account that
  // can reach them, with the reason. Everything else waiting must be
  // `optional`, which resolves it silently when the precondition is genuinely
  // absent.
  const ALWAYS_SATISFIABLE: Record<string, string> = {
    "scan-url": "the scan form is the dashboard, it is always rendered",
    "scan-submit": "same form; a rejected submit keeps the reader on this step",
    "scan-progress":
      "only reachable once the progress panel mounted; a failed run degrades and Back returns to the submit step",
    "go-history": "the nav is in the header on every page",
    "go-compare": "the nav is in the header on every page",
    "go-profile": "the nav is in the header on every page",
    "go-teams": "the nav is in the header on every page",
    "profile-developer": "the profile tab rail always renders every tab",
    schedules: "the developer sub-tab strip always renders every section",
    webhooks: "the developer sub-tab strip always renders every section",
  };

  it("records a decision for every step that waits", () => {
    const undecided = TOUR_STEPS.filter(
      (s) =>
        s.advance.kind !== "next" &&
        !s.optional &&
        !(s.id in ALWAYS_SATISFIABLE),
    ).map((s) => s.id);
    expect(
      undecided,
      "waits on the reader but is neither optional nor listed as always satisfiable",
    ).toEqual([]);
  });

  it("keeps the list honest about steps that no longer wait", () => {
    const stale = Object.keys(ALWAYS_SATISFIABLE).filter((id) => {
      const step = TOUR_STEPS.find((s) => s.id === id);
      return !step || step.advance.kind === "next";
    });
    expect(stale, "listed as a waiting step but does not wait").toEqual([]);
  });

  it("never ends the tour on a step the reader has to satisfy", () => {
    // The last step's primary button is Finish, and Finish is only rendered
    // when the step is not blocked. A waiting step in last place would leave
    // the callout with no forward control at all.
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].advance.kind).toBe("next");
  });
});

describe("no user-facing skip", () => {
  const callout = readFileSync(
    join(ROOT, "components/shared/tour/tour-callout.tsx"),
    "utf8",
  );
  const orchestrator = readFileSync(
    join(ROOT, "components/shared/onboarding-tour.tsx"),
    "utf8",
  );

  it("offers no way to step over a step that is waiting", () => {
    // "Skip this" did not skip a step, it broke the chain: the URL that was
    // never typed is the scan that never ran is the verdict that is not there
    // to read. Next is rendered only where reading is the whole step.
    expect(callout).not.toContain("Skip this");
    expect(callout).toMatch(/\{!blocked && \(/);
  });

  it("offers no way to step over a whole chapter", () => {
    expect(callout).not.toContain("Skip chapter");
    expect(callout).not.toContain("onSkipChapter");
    expect(orchestrator).not.toContain("skipChapter");
  });

  it("still resolves an inapplicable step on its own", () => {
    // The internal auto-skip is not a skip button. It fires on a missing
    // anchor for a step marked optional, which means the feature is not
    // present for this account, and such a step creates no state that a later
    // one needs. That is why it is safe and why it stays.
    expect(orchestrator).toMatch(/if \(!active \|\| !step\.optional\) return;/);
    expect(orchestrator).toContain('if (anchorState !== "missing") return;');
  });

  it("leaves Back enabled as the retry path", () => {
    // With no skip, Back is how a reader gets out of a step whose precondition
    // fell through (a scan that failed, a submit that was rejected). It must
    // depend on nothing but being past the first step.
    expect(orchestrator).toContain("canGoBack={index > 0}");
    expect(callout).toContain("disabled={!canGoBack}");
  });
});

describe("the assistant chapter", () => {
  const chatSteps = TOUR_STEPS.filter((s) => s.chapter === "assistant");

  it("covers opening it, what it answers, and the slash commands", () => {
    expect(chatSteps.map((s) => s.id)).toEqual([
      "open-assistant",
      "assistant-panel",
      "assistant-slash",
      "assistant-commands",
    ]);
  });

  it("is entirely optional, because AI can be off for the account", () => {
    // The widget renders null when AI is disabled, which takes the launcher,
    // the panel, the composer and the command list with it. Every step here
    // has to resolve itself in that case rather than stall.
    for (const step of chatSteps) {
      expect(step.optional, `${step.id} is not optional`).toBe(true);
    }
  });

  it("is the only chapter that asks for the floating chrome", () => {
    // The launcher is hidden for every other step, so a step outside this
    // chapter that pointed at it would spotlight nothing.
    const usingChrome = TOUR_STEPS.filter((s) => s.usesFloatingChrome);
    expect(usingChrome.map((s) => s.id)).toEqual(chatSteps.map((s) => s.id));
  });

  it("needs no navigation, because the widget is on every page", () => {
    for (const step of chatSteps) {
      expect(step.advance.kind).not.toBe("route");
    }
    expect(new Set(chatSteps.map((s) => s.route)).size).toBe(1);
  });

  it("names the assistant and its commands from config, not by hand", () => {
    const source = readFileSync(join(ROOT, "lib/tour/steps.ts"), "utf8");
    expect(source).toContain("AI_BOT_NAME");
    expect(source).toContain("SLASH_COMMANDS");
    // The bot's name, the command names and the retention window are all
    // configurable, so none of them may appear as a literal in the copy.
    const copy = chatSteps.map((s) => `${s.title} ${s.body}`).join(" ");
    expect(source).not.toMatch(/["'`][^"'`]*\bVera\b/);
    expect(copy).toContain(AI_BOT_NAME);
  });
});

describe("hiding the app's own floating chrome", () => {
  const orchestrator = readFileSync(
    join(ROOT, "components/shared/onboarding-tour.tsx"),
    "utf8",
  );
  const widget = readFileSync(
    join(ROOT, "components/ai-chat/chat-widget.tsx"),
    "utf8",
  );

  it("suppresses it for every step that is not about it", () => {
    expect(orchestrator).toContain(
      "setTourChromeSuppressed(active && !step.usesFloatingChrome)",
    );
  });

  it("gives it back when the tour stops", () => {
    // The cleanup covers pausing (the effect is gated on `active`), ending,
    // completing and unmounting. A tour must not outlive itself holding a
    // control that belongs to the app.
    expect(orchestrator).toMatch(
      /return \(\) => setTourChromeSuppressed\(false\);/,
    );
  });

  it("is read by the widget without unmounting an open conversation", () => {
    // The launcher goes, the panel does not: unmounting the whole widget would
    // throw away a conversation in progress, and both are fixed-position so
    // neither costs any layout.
    expect(widget).toContain("useTourChromeSuppressed()");
    expect(widget).toMatch(/tourWantsCornerClear \? null : \(/);
  });
});

describe("there is always a way out", () => {
  // Source-level, because this suite runs in a node environment with no DOM:
  // there is no jsdom or testing-library in the project (see vitest.config.ts),
  // so a rendered-component assertion is not available. What is being pinned
  // here is an agreement between two files, which is the same thing the anchor
  // tests above check and in the same way.
  const callout = readFileSync(
    join(ROOT, "components/shared/tour/tour-callout.tsx"),
    "utf8",
  );
  const orchestrator = readFileSync(
    join(ROOT, "components/shared/onboarding-tour.tsx"),
    "utf8",
  );

  it("puts a worded End tour in the callout footer", () => {
    // Worded, not a glyph. The corner chip is a pause and reads as one; an X
    // that paused was the original complaint.
    expect(callout).toContain("End tour");
    expect(callout).toMatch(/onClick=\{onEnd\}/);
    expect(callout).not.toContain("<X ");
  });

  it("offers it on a step that is blocked waiting for the reader", () => {
    // The one guard allowed around the End tour button is `isLast`, where the
    // primary button says Finish and does the same thing. Anything mentioning
    // the waiting or degraded state would take the exit away exactly when it
    // is most wanted.
    const guard = callout.slice(
      callout.indexOf("{!isLast && ("),
      callout.indexOf("onClick={onEnd}"),
    );
    expect(guard).not.toMatch(/waitingFor|missingOn|anchorState/);
  });

  it("wires it to the same completion the last step uses", () => {
    expect(orchestrator).toMatch(/onEnd=\{complete\}/);
    // goTo past the end is what Finish does, and it lands on complete().
    expect(orchestrator).toMatch(
      /next >= TOUR_STEPS\.length\)\s*\{\s*complete\(\);/,
    );
  });

  it("spends the tour when it ends, so it does not come back", () => {
    // Both halves matter. Clearing the session stops TourMount reopening it on
    // the next page in this tab; the POST is what stops it on the next sign-in.
    const complete = orchestrator.slice(
      orchestrator.indexOf("const complete = useCallback"),
      orchestrator.indexOf("const goTo = useCallback"),
    );
    expect(complete).toContain("tourSession.write(null)");
    expect(complete).toContain("API.AUTH.ONBOARDING");
    expect(complete).toContain('method: "POST"');
    // And it must not burn replay: the flag is cleared again once the server
    // agrees, which is what lets Profile's replay control start a new run.
    expect(orchestrator).toContain("dismissedRef.current = false");
  });

  it("gives the paused pill a permanent dismiss of its own", () => {
    const pill = orchestrator.slice(
      orchestrator.indexOf('if (phase === "paused")'),
      orchestrator.indexOf("if (!active || viewport.width === 0)"),
    );
    expect(pill).toContain("End tour");
    expect(pill).toMatch(/onClick=\{complete\}/);
  });

  it("keeps the callout operable under a modal", () => {
    // The tour is mounted in the root layout, so it is a sibling body child
    // and a modal's inert sweep would take it down with the page behind the
    // dialog: End tour went dead for as long as a modal was up, which is the
    // whole of the AI-choice step. See lib/hooks/use-modal-a11y.ts.
    expect(callout).toContain("OVERLAY_PASSTHROUGH");
    const a11y = readFileSync(
      join(ROOT, "lib/hooks/use-modal-a11y.ts"),
      "utf8",
    );
    expect(a11y).toMatch(/hasAttribute\(OVERLAY_PASSTHROUGH\)/);
  });
});

describe("matchesRoute", () => {
  it("matches on the path alone when the route declares no params", () => {
    expect(matchesRoute("/history", "/history", new URLSearchParams())).toBe(
      true,
    );
    expect(
      matchesRoute("/history", "/history", new URLSearchParams("scan=42")),
    ).toBe(true);
    expect(matchesRoute("/history", "/compare", new URLSearchParams())).toBe(
      false,
    );
  });

  it("requires every param the route declares", () => {
    const route = "/profile?tab=developer&dtab=webhooks";
    expect(
      matchesRoute(
        route,
        "/profile",
        new URLSearchParams("tab=developer&dtab=webhooks"),
      ),
    ).toBe(true);
    expect(
      matchesRoute(route, "/profile", new URLSearchParams("tab=developer")),
    ).toBe(false);
    expect(
      matchesRoute(
        route,
        "/profile",
        new URLSearchParams("tab=developer&dtab=api-keys"),
      ),
    ).toBe(false);
  });

  it("ignores params the route does not mention", () => {
    // The profile page writes ?dtab= of its own the moment a sub-tab is
    // clicked. A step that only asked for ?tab=developer must not stop
    // matching because of it.
    expect(
      matchesRoute(
        "/profile?tab=developer",
        "/profile",
        new URLSearchParams("tab=developer&dtab=schedules"),
      ),
    ).toBe(true);
  });
});
