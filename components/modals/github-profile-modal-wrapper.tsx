"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LazyMount } from "@/components/shared/lazy-mount";

const loadGithubProfileModal = () =>
  import("./github-profile-modal").then((mod) => mod.GithubProfileModal);

/**
 * GitHub's counterpart to the Discord gate: the profile prompt is only drawn
 * for the page load that follows the OAuth redirect back, so its chunk is only
 * fetched when those parameters are on the URL. See
 * discord-profile-modal-wrapper.tsx.
 */
function GithubProfileModalGate() {
  const searchParams = useSearchParams();
  const wanted =
    searchParams.get("github_connected") === "true" &&
    !!searchParams.get("github_username");
  return <LazyMount wanted={wanted} load={loadGithubProfileModal} />;
}

export function GithubProfileModalWrapper() {
  return (
    <Suspense fallback={null}>
      <GithubProfileModalGate />
    </Suspense>
  );
}
