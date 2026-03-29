"use client"

import { Suspense } from "react"
import { DiscordProfileModal } from "./discord-profile-modal"

export function DiscordProfileModalWrapper() {
  return (
    <Suspense fallback={null}>
      <DiscordProfileModal />
    </Suspense>
  )
}
