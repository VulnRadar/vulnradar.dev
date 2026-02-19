import { NextResponse } from "next/server"
import { APP_VERSION, ENGINE_VERSION, VERSION_CHECK_URL } from "@/lib/constants"

// Fun messages for people somehow running a version from the future
const TIME_TRAVELER_MESSAGES = [
  "Whoa, you're running a version from the future! Can you tell us if we ever fix that one CSS bug?",
  "Nice try, time traveler. What's the stock market doing in your timeline?",
  "You're ahead of us... literally. Did the robots take over yet?",
  "Either you're from the future or you bumped the version manually. Either way, respect.",
  "Version from the future detected. Quick, what are the lottery numbers?",
  "Hold up, this version doesn't exist yet. Are you a wizard?",
  "Running unreleased code? You absolute legend.",
  "You're living in the future and we're still fixing merge conflicts.",
]

export async function GET() {
  try {
    const res = await fetch(VERSION_CHECK_URL, {
      signal: AbortSignal.timeout(5000),
      headers: { "Accept": "application/json" },
      next: { revalidate: 3600 }, // cache for 1 hour
    })

    if (!res.ok) {
      return NextResponse.json({
        current: APP_VERSION,
        engine: ENGINE_VERSION,
        latest: null,
        status: "unknown",
        message: "Could not check for updates right now.",
      })
    }

    const data = await res.json()
    const latest = data.version as string

    const currentParts = APP_VERSION.split(".").map(Number)
    const latestParts = latest.split(".").map(Number)

    let status: "up-to-date" | "behind" | "ahead" | "unknown" = "unknown"
    let message = ""

    // Compare semver
    for (let i = 0; i < 3; i++) {
      const c = currentParts[i] || 0
      const l = latestParts[i] || 0
      if (c > l) {
        status = "ahead"
        message = TIME_TRAVELER_MESSAGES[Math.floor(Math.random() * TIME_TRAVELER_MESSAGES.length)]
        break
      }
      if (c < l) {
        status = "behind"
        const behindMajor = latestParts[0] - currentParts[0]
        const behindMinor = latestParts[1] - currentParts[1]
        if (behindMajor > 0) {
          message = `You are ${behindMajor} major version${behindMajor > 1 ? "s" : ""} behind. Update strongly recommended.`
        } else if (behindMinor > 0) {
          message = `A newer version (v${latest}) is available with new features and fixes.`
        } else {
          message = `A patch update (v${latest}) is available with bug fixes.`
        }
        break
      }
    }

    if (status === "unknown") {
      status = "up-to-date"
      message = "You're running the latest version."
    }

    return NextResponse.json({
      current: APP_VERSION,
      engine: ENGINE_VERSION,
      latest,
      status,
      message,
    })
  } catch {
    return NextResponse.json({
      current: APP_VERSION,
      engine: ENGINE_VERSION,
      latest: null,
      status: "unknown",
      message: "Could not check for updates. Are you offline?",
    })
  }
}
