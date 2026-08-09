"use client";

import { Suspense } from "react";
import { GithubProfileModal } from "./github-profile-modal";

export function GithubProfileModalWrapper() {
  return (
    <Suspense fallback={null}>
      <GithubProfileModal />
    </Suspense>
  );
}
