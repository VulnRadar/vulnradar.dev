"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { tourSession } from "@/lib/tour/tour-session";
import { tourWanted } from "@/components/shared/tour/tour-gating";
import { LazyMount } from "@/components/shared/lazy-mount";

const loadOnboardingTour = () =>
  import("@/components/shared/onboarding-tour").then(
    (mod) => mod.OnboardingTour,
  );

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
 * tab. Everyone else gets a component that returns null and one boolean. What
 * counts as "has one to run" is tourWanted(), which also holds the tour back
 * while a blocking modal is open.
 */
export function TourMount() {
  const { me } = useAuth();
  const [resumable, setResumable] = useState(false);

  // Read once, in an effect rather than a lazy useState initialiser, because
  // this component is server-rendered as part of the root layout and
  // sessionStorage does not exist there: an initialiser would compute one
  // answer on the server and a different one on the client.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage, which is exactly the external system an effect is for; it cannot be read during render
    setResumable(tourSession.read() !== null);
  }, []);

  return (
    <LazyMount wanted={tourWanted(me, resumable)} load={loadOnboardingTour} />
  );
}
