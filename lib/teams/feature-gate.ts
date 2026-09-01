import { NextResponse } from "next/server";
import { getSetting } from "@/lib/config/runtime-config";

/**
 * FEATURE_TEAMS kill switch for the whole /api/v3/teams surface.
 *
 * The flag used to gate exactly one handler (POST /api/v3/teams, "create a
 * team") while GET, PATCH, DELETE, the members routes, invitations,
 * teammates and member-scans all kept working. That contradicted both the
 * admin registry help ("Turning this off hides team pages from users who
 * already belong to a team") and app/docs/teams ("no team routes do anything
 * useful"): an operator who turned Teams off still had every existing team
 * fully live, and only discovered the flag from a 403 when someone tried to
 * create a NEW team.
 *
 * Returns a 403 response to hand straight back, or null when the feature is
 * on. Call it after the session check so a signed-out caller still gets 401
 * rather than leaking whether the deployment has teams enabled.
 */
export async function teamsDisabledResponse(): Promise<NextResponse | null> {
  if (await getSetting("FEATURE_TEAMS")) return null;
  return NextResponse.json(
    { error: "Teams are disabled on this deployment." },
    { status: 403 },
  );
}
