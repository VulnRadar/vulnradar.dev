"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { useAuth, type MeResponse } from "@/components/providers/auth-provider";
import { tourSession } from "@/lib/tour/tour-session";

/**
 * Is the terms gate standing in front of the app right now?
 *
 * components/auth/tos-gate.tsx owns this decision and this mirrors the two
 * comparisons it makes. It is duplicated rather than shared because the gate
 * expresses its answer as a rendered blur over `children`, and the tour is not
 * one of its children: it is a sibling in the root layout, mounted there so it
 * can survive a navigation. Without this check a brand-new account gets the
 * terms modal and the tour overlay stacked on each other at first sign-in,
 * with the tour on top telling them to type a URL into a form the gate has
 * deliberately made unreachable.
 */
function termsGateOpen(me: MeResponse): boolean {
  if (!me.tosAcceptedAt) return true;
  if (!me.termsUpdatedAt) return false;
  return new Date(me.tosAcceptedAt) < new Date(me.termsUpdatedAt);
}

/**
 * Puts the product tour in the root layout without putting its code on every
 * page.
 *
 * The tour has to be mounted app-wide, because it walks the reader across six
 * routes and a per-page mount would restart it at each one. But the layout
 * entry chunk is loaded by all ~790 routes including the public marketing and
 * SEO pages, and the tour is a few kilobytes of step copy, placement maths and
 * overlay chrome that a signed-out visitor to /landing will never see. Same
 * trade components/shared/chat-widget-mount.tsx makes, for the same reason.
 *
 * So: this wrapper is tiny and always loaded, the tour itself is imported only
 * once the account actually has one to run, or has one half finished in this
 * tab. Everyone else gets a component that returns null and one boolean.
 */
export function TourMount() {
  const { me } = useAuth();
  const [Tour, setTour] = useState<ComponentType | null>(null);
  const [resumable, setResumable] = useState(false);

  // Read once, in an effect rather than a lazy useState initialiser, because
  // this component is server-rendered as part of the root layout and
  // sessionStorage does not exist there: an initialiser would compute one
  // answer on the server and a different one on the client.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage, which is exactly the external system an effect is for; it cannot be read during render
    setResumable(tourSession.read() !== null);
  }, []);

  // Signed in and past the terms gate, then either the account has never seen
  // the tour or this tab has one half finished. The signed-in half also covers
  // the stale case: a session left behind by a sign-out must not pull the
  // tour's chunk down for whoever uses the browser next.
  const signedIn = !!me?.userId;
  const wanted =
    signedIn &&
    !termsGateOpen(me) &&
    (me.onboardingCompleted === false || resumable);

  useEffect(() => {
    if (!wanted || Tour) return;
    let cancelled = false;
    void import("@/components/shared/onboarding-tour").then((mod) => {
      // Through an updater, so React does not mistake the component for a
      // lazy state initialiser and call it.
      if (!cancelled) setTour(() => mod.OnboardingTour);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, Tour]);

  return Tour ? <Tour /> : null;
}
