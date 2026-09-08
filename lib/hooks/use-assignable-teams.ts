"use client";

import { useEffect, useMemo, useState } from "react";
import { API, hasTeamPermission } from "@/lib/config/client-constants";
import { useClientConfig } from "@/lib/hooks/use-client-config";

export interface TeamOption {
  id: number;
  name: string;
  role: string;
}

export interface AssignableTeamsResult {
  /**
   * Teams whose role grants "manage_scans" -- the client-side mirror of
   * getAssignableTeamIds (lib/auth/team-resource-access.ts), which is what
   * every teamId PATCH validates against. Offering anything else would be a
   * control whose only outcome is a 400.
   */
  assignable: TeamOption[];
  /**
   * Every team the caller belongs to, viewer roles included. Only used to put
   * a name on a resource that is already assigned to a team the caller can no
   * longer assign to, so the picker reads "Platform" instead of going blank
   * and implying the resource is personal.
   */
  all: TeamOption[];
  /** False until the answer is known. "No teams" and "not fetched yet" are
   *  different facts, and a picker must not render the second as the first. */
  loaded: boolean;
}

const NO_TEAMS: TeamOption[] = [];

/**
 * The caller's teams, split into the ones they may assign a resource to and
 * the ones they merely belong to.
 *
 * Reuses GET /api/v3/teams rather than adding an endpoint: it already returns
 * the caller's membership row per team, including `role`, which is the only
 * thing the assignable/not split turns on. It returns more than this needs
 * (owner details, member counts, plan limits) and that is fine.
 *
 * Nothing is requested when FEATURE_TEAMS is off, because every /api/v3/teams
 * route answers 403 in that case and the answer is already known.
 */
export function useAssignableTeams(): AssignableTeamsResult {
  const { featureTeams, loaded: configLoaded } = useClientConfig();
  const [teams, setTeams] = useState<TeamOption[] | null>(null);

  useEffect(() => {
    if (!configLoaded || !featureTeams) return;
    let cancelled = false;
    fetch(API.TEAMS)
      .then((res) => (res.ok ? res.json() : { teams: [] }))
      .then((data: { teams?: TeamOption[] }) => {
        if (cancelled) return;
        setTeams(
          (data.teams ?? []).map((team) => ({
            id: team.id,
            name: team.name,
            role: team.role,
          })),
        );
      })
      .catch(() => {
        // A failed load leaves the picker unrendered rather than showing an
        // empty one, same silent-fail-to-nothing the sections around it use.
        if (!cancelled) setTeams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [configLoaded, featureTeams]);

  return useMemo(() => {
    const all = teams ?? NO_TEAMS;
    return {
      all,
      assignable: all.filter((team) =>
        hasTeamPermission(team.role, "manage_scans"),
      ),
      loaded: teams !== null || (configLoaded && !featureTeams),
    };
  }, [teams, configLoaded, featureTeams]);
}
