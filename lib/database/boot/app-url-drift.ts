/**
 * Next replaces process.env.NEXT_PUBLIC_APP_URL with its build-time value, so
 * the read below is the origin compiled into this build, and it is the point of
 * this file. Server links read the running environment now
 * (lib/config/server-app-url.ts), but a pulled image still carries the origin
 * it was built with in its browser bundle, and nothing told the operator the
 * two disagreed.
 *
 * An image built with no URL at all has nothing compiled in to disagree.
 */
import { serverAppUrl } from "@/lib/config/server-app-url";

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export async function reportAppUrlDrift(
  appName: string,
  built: string | undefined = process.env.NEXT_PUBLIC_APP_URL,
): Promise<void> {
  if (!built) return;
  try {
    const running = await serverAppUrl();
    if (originOf(built) === originOf(running)) return;
    console.error(
      `[${appName}] This build has NEXT_PUBLIC_APP_URL=${built} compiled in, but this server is configured for ${running}. Links the server builds follow the running configuration; browser code keeps the compiled value until the image is rebuilt with NEXT_PUBLIC_APP_URL set to ${running}.`,
    );
  } catch (err) {
    console.error(`[${appName}] Could not compare the app URL:`, err);
  }
}
