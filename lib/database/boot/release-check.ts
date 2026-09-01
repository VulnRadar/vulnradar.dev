/**
 * The startup banner and the "is there a newer release" check.
 *
 * Nothing here touches the database. It is split out of instrumentation.ts so
 * the boot sequence there reads as a list of phases rather than as 60 lines of
 * version-string arithmetic in the middle of the schema path.
 *
 * Every failure is swallowed: an install with no outbound network access, or
 * one running behind a proxy that blocks api.github.com, must still boot.
 */

export interface ReleaseCheckContext {
  appName: string;
  appVersion: string;
  engineVersion: string;
  versionCheckUrl: string;
  releasesUrl: string;
}

export async function reportRunningVersion({
  appName,
  appVersion,
  engineVersion,
  versionCheckUrl,
  releasesUrl,
}: ReleaseCheckContext): Promise<void> {
  console.log(
    `\x1b[36m[${appName}]\x1b[0m Starting ${appName} v${appVersion} (Detection Engine v${engineVersion})`,
  );
  try {
    const res = await fetch(versionCheckUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;

    const release = await res.json();
    const tagName = (release.tag_name as string) || "";
    const latest = tagName.replace(/^v/, "");
    const releaseUrl =
      (release.html_url as string) || `${releasesUrl}/tag/${tagName}`;
    const cur = appVersion.split(".").map(Number);
    const lat = latest.split(".").map(Number);

    let status: "current" | "behind" | "ahead" = "current";
    for (let i = 0; i < 3; i++) {
      if ((cur[i] || 0) > (lat[i] || 0)) {
        status = "ahead";
        break;
      }
      if ((cur[i] || 0) < (lat[i] || 0)) {
        status = "behind";
        break;
      }
    }

    if (status === "current") {
      console.log(
        `\x1b[32m[${appName}]\x1b[0m You're running the latest version (v${appVersion}).`,
      );
    } else if (status === "behind") {
      console.log(
        `\x1b[33m[${appName}]\x1b[0m Update available! You're on v${appVersion}, latest is v${latest}.`,
      );
      console.log(`\x1b[33m[${appName}]\x1b[0m ${releaseUrl}`);
    } else {
      const msgs = [
        "Whoa, you're running a version from the future!",
        "Nice try, time traveler.",
        "You're ahead of us... literally.",
        "Running unreleased code? You absolute legend.",
      ];
      console.log(
        `\x1b[35m[${appName}]\x1b[0m Running v${appVersion}, but latest release is v${latest}.`,
      );
      console.log(
        `\x1b[35m[${appName}]\x1b[0m ${msgs[Math.floor(Math.random() * msgs.length)]}`,
      );
    }
  } catch {
    console.log(
      `\x1b[90m[${appName}]\x1b[0m Could not check for updates. Running v${appVersion}.`,
    );
  }
}
