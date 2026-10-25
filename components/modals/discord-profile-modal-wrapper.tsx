"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LazyMount } from "@/components/shared/lazy-mount";

const loadDiscordProfileModal = () =>
  import("./discord-profile-modal").then((mod) => mod.DiscordProfileModal);

/**
 * The Discord profile prompt only exists for the page load that follows the
 * OAuth redirect back, which is the only time these parameters are present.
 * Everyone else (every other visit to every route) used to download the
 * dialog, avatar and checkbox layers for a modal that renders null, so the
 * chunk is now fetched only when the redirect has actually brought them.
 *
 * The modal seeds its `open` state from the same parameters on its first
 * render, which is why it is mounted when they appear and not before.
 */
function DiscordProfileModalGate() {
  const searchParams = useSearchParams();
  const wanted =
    searchParams.get("discord_connected") === "true" &&
    !!searchParams.get("discord_username");
  return <LazyMount wanted={wanted} load={loadDiscordProfileModal} />;
}

export function DiscordProfileModalWrapper() {
  return (
    <Suspense fallback={null}>
      <DiscordProfileModalGate />
    </Suspense>
  );
}
