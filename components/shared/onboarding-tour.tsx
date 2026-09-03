"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { API } from "@/lib/config/client-constants";
import { LOCATION_CHANGE_EVENT } from "@/lib/ui/url-state";
import { cn } from "@/lib/ui/utils";
import { focus as focusRing } from "@/lib/ui/animations";
import {
  refreshAuthCache,
  useAuth,
} from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { resolveAnchor, TOUR_ANCHORS } from "@/lib/tour/anchors";
import { padRect } from "@/lib/tour/placement";
import {
  matchesRoute,
  TOUR_CHAPTERS,
  TOUR_STEPS,
  type TourStep,
} from "@/lib/tour/steps";
import { tourSession } from "@/lib/tour/tour-session";
import { setTourChromeSuppressed } from "@/lib/tour/tour-chrome";
import { useAnchorRect } from "@/lib/tour/use-anchor-rect";
import { TourCallout } from "./tour/tour-callout";
import { TourSpotlight } from "./tour/tour-spotlight";

/**
 * The product tour.
 *
 * This used to be a centred modal holding eight slides of prose. It never
 * pointed at anything, never asked for anything, and could be read start to
 * finish with the app closed, which is a fair description of a brochure and not
 * of a tour. What it is now: a scrim with a hole cut in the real control, a
 * callout anchored beside it, and steps that wait for the reader to type a URL,
 * press Scan, open a finding and cross into History rather than counting down.
 *
 * Four things are load bearing.
 *
 * MOUNTED IN THE ROOT LAYOUT, NOT ON THE DASHBOARD. The tour crosses six
 * routes. Mounted per page it would unmount and restart on each of them; in the
 * layout it survives every client-side navigation, so a step index is just
 * React state for the whole run. lib/tour/tour-session.ts mirrors the index to
 * sessionStorage for the cases where even the layout remounts (a hard reload, a
 * middleware redirect, back into a server-rendered page).
 *
 * NOT A MODAL, ON PURPOSE. No aria-modal, no focus trap, and the page behind
 * is not inert. All three are correct for a dialog and all three are wrong
 * here: the entire premise is that the reader operates the real control, and a
 * trap would make the highlighted button unreachable by keyboard. That is also
 * why it is not built on components/ui/modal-grammar.ts and why the modal guard
 * test does not apply to it: nothing here is a DialogContent, and the scrim is
 * built from --background exactly as the grammar requires anyway.
 *
 * TWO EXITS, AND THEY SAY WHICH THEY ARE. The old version's only exit was a
 * POST that marked onboarding complete, so a stray click on the scrim or a
 * reflexive Escape spent a one-time thing. There are two now and they are
 * labelled: the pause chip in the callout's corner (and Escape) takes the
 * overlay down, keeps the step and leaves a resume pill; End tour, in the
 * footer of every step, spends it for good.
 *
 * The chip used to be an X that paused, which is the worst of both. An X is
 * read as "get me out of this", so somebody who wanted out pressed it, got a
 * pill back, and had to work out that the pill's own button was the real exit.
 * A pause glyph that pauses and a button that says End tour is the whole fix,
 * and it is why End tour is rendered on every step including the ones that are
 * blocked waiting on the reader: an exit that is only available once the tour
 * is happy is not an exit.
 *
 * REPLAY WORKS FROM ANYWHERE. Profile's "Replay product tour" button flips the
 * server flag and calls refreshAuthCache(). The old component read that flag
 * once, in a mount effect with an empty dependency list, so replay only worked
 * because it also navigated to the dashboard and forced a remount; pressing it
 * while already on the dashboard did nothing at all. This watches useAuth()
 * instead, so the flag flipping is enough on its own and the tour starts on
 * whatever page the reader is standing on, /profile included.
 */

type Phase = "off" | "running" | "paused";

/** How much room the spotlight leaves around the element it highlights. */
const SPOTLIGHT_PAD = 6;

/** Text entry, where stealing focus to the callout would interrupt typing. */
function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** The first thing inside `el` a keyboard can reach, or `el` itself. */
function focusTarget(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  if (
    el.matches(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
  ) {
    return el;
  }
  return el.querySelector<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
}

/** What the callout says while a step is waiting on the reader. */
function waitingMessage(step: TourStep): string | null {
  if (step.advance.kind === "next") return null;
  if (step.waitLabel) return step.waitLabel;
  switch (step.advance.kind) {
    case "click":
      return "Waiting for that click.";
    case "input":
      return `Waiting for at least ${step.advance.minLength} characters.`;
    case "appear":
      return "Waiting for it to show up.";
    case "disappear":
      return "Waiting for this to be dealt with.";
    case "route":
      return "Waiting for you to open it.";
  }
}

export function OnboardingTour() {
  const { me } = useAuth();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("off");
  const [index, setIndex] = useState(0);
  const [takeFocus, setTakeFocus] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [radius, setRadius] = useState(8);
  const [loc, setLoc] = useState({ pathname: "", search: "" });
  const replayRef = useRef(false);
  // Set the moment the reader finishes or ends the tour, so the boot effect
  // below does not immediately reopen it in the window between our POST and
  // the auth cache catching up with the new flag. Cleared as soon as the
  // server agrees, which is also what lets a later replay through.
  const dismissedRef = useRef(false);

  const step = TOUR_STEPS[index];
  const active = phase === "running";

  // Decide whether the tour should be running at all. Watching useAuth()
  // rather than doing a one-shot fetch on mount is what makes replay work:
  // the Profile button flips the flag server-side and calls refreshAuthCache,
  // and this sees the new value wherever the reader happens to be standing.
  useEffect(() => {
    if (!me?.userId) return;
    if (me.onboardingCompleted) {
      dismissedRef.current = false;
      // Drop any half-finished session. The flag being true means the tour was
      // finished, here or in another tab, and a leftover index would otherwise
      // make TourMount load the tour on the next page for a run that is over.
      tourSession.write(null);
      return;
    }
    if (dismissedRef.current) return;
    const saved = tourSession.read();
    if (saved) {
      replayRef.current = saved.replay;
      setIndex(saved.step);
      setPhase(saved.paused ? "paused" : "running");
      return;
    }
    replayRef.current = false;
    tourSession.write({ step: 0, paused: false, replay: false });
    setIndex(0);
    setPhase("running");
  }, [me]);

  // The location, read from the URL rather than from useSearchParams. The
  // bridge in lib/ui/url-state.ts already patches pushState/replaceState and
  // popstate into one event, so this catches a Link, a router.push, the back
  // button, and the profile page writing its own ?tab= and ?dtab= params,
  // which is the one a hook reading the router's params would miss the timing
  // of. It also keeps this component out of the Suspense boundary
  // useSearchParams would require of every route in the layout.
  useEffect(() => {
    function sync() {
      setLoc({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    }
    sync();
    window.addEventListener(LOCATION_CHANGE_EVENT, sync);
    return () => window.removeEventListener(LOCATION_CHANGE_EVENT, sync);
  }, []);

  useEffect(() => {
    function measure() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const {
    rect,
    state: anchorState,
    element,
  } = useAnchorRect(step.anchor, active);

  // Match the hole to the shape of the thing in it. A pill-shaped button
  // inside a square hole looks like a rendering fault, and every radius in the
  // app is on the ladder in CLAUDE.md, so copying the computed value lands on
  // one of four sane numbers rather than an arbitrary one.
  useEffect(() => {
    if (!element) {
      setRadius(8);
      return;
    }
    const raw = parseFloat(
      window.getComputedStyle(element).borderTopLeftRadius,
    );
    setRadius(Number.isFinite(raw) ? Math.min(raw + SPOTLIGHT_PAD, 28) : 8);
  }, [element]);

  const persist = useCallback((next: number, paused: boolean) => {
    tourSession.write({ step: next, paused, replay: replayRef.current });
  }, []);

  const complete = useCallback(() => {
    dismissedRef.current = true;
    setPhase("off");
    tourSession.write(null);
    // Fire and forget. A failed POST means the tour offers itself again on the
    // next visit, which is a far better failure than a reader who cannot get
    // out of it because the network blipped.
    fetch(API.AUTH.ONBOARDING, { method: "POST" })
      .then(() => refreshAuthCache())
      .catch(() => {});
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (next >= TOUR_STEPS.length) {
        complete();
        return;
      }
      const clamped = Math.max(0, next);
      // Keep the reader in the field they are typing in. The callout takes
      // focus on every other step so a screen reader announces it; when it
      // cannot, the live region below carries the same announcement instead.
      const typing = isTextEntry(document.activeElement);
      setTakeFocus(!typing);
      setAnnouncement(
        typing
          ? `Step ${clamped + 1} of ${TOUR_STEPS.length}. ${TOUR_STEPS[clamped].title}`
          : "",
      );
      setIndex(clamped);
      persist(clamped, false);
    },
    [complete, persist],
  );

  const advance = useCallback(() => goTo(index + 1), [goTo, index]);

  const pause = useCallback(() => {
    setPhase("paused");
    persist(index, true);
  }, [index, persist]);

  // Escape leaves the takeover immediately, which is what a keyboard user is
  // entitled to, without spending the tour. See the note at the top of the
  // file: this is the regression the old single-exit design had.
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      pause();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, pause]);

  // The advance conditions. One effect, re-armed per step, because only one
  // condition is ever live at a time and tearing all of them down together is
  // the only way to be sure a stale listener cannot skip a step.
  useEffect(() => {
    if (!active) return;
    const adv = step.advance;

    if (adv.kind === "click") {
      const selector = `[data-tour="${TOUR_ANCHORS[adv.on]}"]`;
      // Capture phase: the anchor's own handler may unmount it (pressing Scan
      // swaps the form out for the progress panel), and by the bubble phase
      // the element the click started on is gone and closest() finds nothing.
      const onClick = (e: MouseEvent) => {
        const target = e.target;
        if (target instanceof Element && target.closest(selector)) advance();
      };
      document.addEventListener("click", onClick, true);
      return () => document.removeEventListener("click", onClick, true);
    }

    if (adv.kind === "input") {
      const selector = `[data-tour="${TOUR_ANCHORS[adv.on]}"]`;
      const onInput = (e: Event) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!target.closest(selector)) return;
        if (target.value.trim().length >= adv.minLength) advance();
      };
      document.addEventListener("input", onInput, true);
      return () => document.removeEventListener("input", onInput, true);
    }

    if (adv.kind === "appear" || adv.kind === "disappear") {
      // Polled rather than observed: a MutationObserver on document.body with
      // subtree:true fires on every keystroke anywhere in the app, and the
      // thing being waited for here is a scan that takes seconds. One
      // querySelector a frame is cheaper and has no teardown subtleties.
      //
      // The two kinds are one poll because they are one question asked with
      // opposite signs, and because "disappear" has to be able to resolve on
      // its very first frame. A step waiting for a dialog that this account
      // never sees must not stall the tour, and it must not sit through the
      // missing-anchor grace window either: absent is the answer, immediately.
      const wanted = adv.kind === "appear";
      let frame = requestAnimationFrame(function poll() {
        if (!!resolveAnchor(adv.of) === wanted) {
          advance();
          return;
        }
        frame = requestAnimationFrame(poll);
      });
      return () => cancelAnimationFrame(frame);
    }

    return;
  }, [active, index, step.advance, advance]);

  // Route advances are separate because they are driven by the location
  // effect's state rather than by a listener of their own.
  useEffect(() => {
    if (!active) return;
    if (step.advance.kind !== "route") return;
    if (!loc.pathname) return;
    if (
      matchesRoute(
        step.advance.to,
        loc.pathname,
        new URLSearchParams(loc.search),
      )
    ) {
      advance();
    }
  }, [active, step.advance, loc, advance]);

  // An optional step whose anchor never turned up does not apply to this
  // account, so it goes by without saying anything. A required one degrades to
  // a card instead, which is handled in the render.
  //
  // This and the advance conditions above can both fire on the same step, and
  // that is fine rather than merely tolerated. A `disappear` step is normally
  // also `optional`, and when its anchor never mounts both paths mean the same
  // thing: the poll answers on the first frame, the grace window would answer
  // two and a half seconds later, and both call advance() with the same
  // captured index, so the second one is a no-op setIndex to a value already
  // set. What matters is that neither path can wait forever: a step is only
  // ever held open by an anchor that IS on the page.
  useEffect(() => {
    if (!active || !step.optional) return;
    if (anchorState !== "missing") return;
    advance();
  }, [active, step.optional, anchorState, advance]);

  // Get the app's own floating chrome out of the way, except on the steps that
  // are about it. Today that is the AI assistant's launcher: a filled circle
  // fixed to the corner of every page, which glows through the scrim beside a
  // callout pointing somewhere else and reads as a rendering fault.
  //
  // Pausing is covered by `active` being in the expression rather than by a
  // cleanup, and that is deliberate: a cleanup here would set false and then
  // immediately set true again on every single step change, which is a
  // launcher that blinks once per step.
  useEffect(() => {
    setTourChromeSuppressed(active && !step.usesFloatingChrome);
  }, [active, step.usesFloatingChrome]);

  // Teardown, separately, so it runs once and only on the way out. This is
  // what guarantees the tour cannot hide a control it does not own for longer
  // than it is on screen: ending it, finishing it, signing out and the chunk
  // being torn down all land here.
  useEffect(() => {
    return () => setTourChromeSuppressed(false);
  }, []);

  if (phase === "paused") {
    return (
      <div className="fixed bottom-4 left-4 z-100 flex items-center gap-1 rounded-full border border-border bg-card/95 py-1 pl-3 pr-1 shadow-lg backdrop-blur-xs">
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          Tour paused, {index + 1} of {TOUR_STEPS.length}
        </span>
        <Button
          size="sm"
          onClick={() => {
            setTakeFocus(true);
            setPhase("running");
            persist(index, false);
          }}
          className="h-7 gap-1 rounded-full px-2.5 text-xs"
        >
          <Play className="h-3 w-3" aria-hidden="true" />
          Resume
        </Button>
        {/* Worded, not an X. The pill is where somebody who wanted out of the
            tour and pressed the pause chip ends up, so the way out has to be
            readable rather than inferred from a glyph. */}
        <button
          type="button"
          onClick={complete}
          className={cn(
            "flex h-7 items-center rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            focusRing.ring,
          )}
        >
          End tour
        </button>
      </div>
    );
  }

  if (!active || viewport.width === 0) return null;

  const found = anchorState === "found" && rect !== null;
  const degraded = anchorState === "missing" && !step.optional;
  const padded = found ? padRect(rect, SPOTLIGHT_PAD, viewport) : null;
  // Three states, three sentences, and the middle one is the reason this is
  // not a boolean. Found: say what the step is waiting on. Never turned up:
  // say so, in the degraded card, rather than claiming to wait for a click on
  // something that is not there. Still looking: say THAT, because the grace
  // window is a couple of seconds and a card sitting silently in the middle of
  // the screen for two seconds reads as the tour having lost its place.
  const waiting = found
    ? waitingMessage(step)
    : anchorState === "resolving"
      ? "Looking for it on this page."
      : null;

  const chapter = TOUR_CHAPTERS.find((c) => c.id === step.chapter);
  // A step that asks for something cannot be stepped over. The tour is a
  // chain: the URL typed in one step is what the next one scans, the scan is
  // what the verdict reads, the verdict's findings are what the finding
  // chapter opens. Skipping a link does not skip one step, it invalidates
  // every step after it and lands the reader in the degraded card over and
  // over. So Next is offered only where reading IS the step, and the two real
  // ways forward from a waiting step are to do the thing or to end the tour.
  const blocked = step.advance.kind !== "next";

  const offRoute =
    loc.pathname !== "" &&
    !matchesRoute(step.route, loc.pathname, new URLSearchParams(loc.search));

  const anchorFocusTarget = focusTarget(element);

  return (
    <>
      <TourSpotlight
        rect={padded}
        radius={radius}
        waiting={waiting !== null}
        viewport={viewport}
      />

      {/* Carries the step change to a screen reader in the one case the
          callout cannot: when focus was deliberately left in a field the
          reader is typing into. Empty the rest of the time, so it never
          double-announces what the dialog itself already said. */}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      <TourCallout
        rect={padded}
        viewport={viewport}
        placement={step.placement ?? "auto"}
        index={index}
        total={TOUR_STEPS.length}
        chapterLabel={chapter?.label ?? ""}
        title={step.title}
        body={step.body}
        takeFocus={takeFocus}
        waitingFor={waiting}
        missingOn={degraded ? step.route : null}
        canGoBack={index > 0}
        isLast={index === TOUR_STEPS.length - 1}
        blocked={blocked}
        onBack={() => goTo(index - 1)}
        onAdvance={advance}
        onPause={pause}
        onEnd={complete}
        onFocusAnchor={
          anchorFocusTarget ? () => anchorFocusTarget.focus() : null
        }
        // router.push rather than a location assign: a full page load would
        // throw away the React state this whole design leans on, and the
        // session mirror would then have to reconstruct a step the reader had
        // not actually left.
        onGoToRoute={
          degraded && offRoute ? () => router.push(step.route) : null
        }
      />
    </>
  );
}
