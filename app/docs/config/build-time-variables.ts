import {
  SETTINGS_REGISTRY,
  type SettingDefinition,
} from "@/lib/config/registry";

/**
 * The NEXT_PUBLIC_* names docker-compose.yml passes under build.args. Mirrors
 * that file by hand because a page cannot read it at render time;
 * tests/app/docs/config-page.test.ts compares the two. .dockerignore keeps
 * .env out of the build context, so a name missing from this list never
 * reaches a Docker build however it is set.
 */
export const COMPOSE_BUILD_ARGS: readonly string[] = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPPORT_EMAIL",
  "NEXT_PUBLIC_DISCORD_INVITE_URL",
  "NEXT_PUBLIC_CHROME_WEB_STORE_URL",
  "NEXT_PUBLIC_FIREFOX_ADDON_URL",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
];

export interface BuildTimeVariable {
  name: string;
  sets: string;
  apply: string;
}

const REBUILD = "docker compose build app, or npm run build";

function applyFor(name: string, dockerFallback: string): string {
  return COMPOSE_BUILD_ARGS.includes(name)
    ? REBUILD
    : `npm run build. Not a Docker build arg, so under Docker ${dockerFallback}`;
}

/** The ones with no row in SETTINGS_REGISTRY to read a label from. */
const WITHOUT_SETTING: BuildTimeVariable[] = [
  {
    name: "NEXT_PUBLIC_APP_URL",
    sets: "Your own domain in pages, canonical tags, social cards, sitemap.xml and most email links. OAuth redirects and links that carry a token also read it from the running container, so it belongs in .env either way.",
    apply: REBUILD,
  },
  {
    name: "NEXT_PUBLIC_SUPPORT_EMAIL",
    sets: "Support address shown in the UI. Compose fills this build arg from SUPPORT_EMAIL in .env.",
    apply: REBUILD,
  },
  {
    name: "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    sets: "Turns on the Turnstile widget. The secret key beside it is an ordinary runtime variable.",
    apply: REBUILD,
  },
  {
    name: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    sets: "Stripe checkout in the browser.",
    apply: REBUILD,
  },
  {
    name: "NEXT_PUBLIC_IPV4_ECHO_URL",
    sets: "IPv4 capture on dual-stack sign-ins.",
    apply: applyFor(
      "NEXT_PUBLIC_IPV4_ECHO_URL",
      "add it to the Dockerfile and to build.args in docker-compose.yml first",
    ),
  },
];

/**
 * Every NEXT_PUBLIC_* the code reads. The registry-backed rows are derived so
 * a new SOCIAL_* or SEO_* override appears here without anyone remembering to
 * add it.
 */
export const BUILD_TIME_VARIABLES: BuildTimeVariable[] = [
  ...WITHOUT_SETTING,
  ...(Object.entries(SETTINGS_REGISTRY) as [string, SettingDefinition][])
    .filter(([, def]) => def.env?.startsWith("NEXT_PUBLIC_"))
    .map(([key, def]) => ({
      name: def.env as string,
      sets: def.label,
      apply: applyFor(
        def.env as string,
        `edit CONFIG_${key} in lib/config/config-values.ts, then docker compose build app`,
      ),
    })),
];
