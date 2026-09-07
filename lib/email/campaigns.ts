/**
 * Pre-written campaign emails: the messages that are not a reaction to
 * something the recipient just did.
 *
 * Every transactional message this product sends has a template in email.ts,
 * built from the blocks in layout.ts, reviewed once and correct forever after.
 * The one class that had none was the class a person writes: a release
 * announcement, a feature they should know about, an offer, a nudge. The
 * broadcast composer offered an empty textarea labelled "HTML tags are
 * supported", so those messages were hand-written markup, at whatever quality
 * the writer managed on the day, in a product whose whole voice is otherwise
 * pinned down. Two of the notification preference columns that gate them,
 * email_product_updates and email_tips_guides, had existed for months with
 * nothing behind them.
 *
 * These fill in the gap: real templates, in the same voice and the same
 * blocks, that a writer fills in rather than composes. The composer renders
 * one, the writer edits the result, and what goes out looks like the rest of
 * the product instead of like a marketing email that wandered in.
 *
 * Client-safe. layout.ts has no server-only imports and client-constants is
 * the client half of constants, so the admin composer imports this directly
 * and previews exactly what recipients receive.
 */

import {
  APP_NAME,
  APP_URL,
  SUPPORT_EMAIL,
} from "@/lib/config/client-constants";
import {
  escapeHtml,
  emailHeading,
  emailLead,
  emailParagraph,
  emailStrong,
  emailLink,
  emailButton,
  emailNote,
  emailPanel,
  emailQuote,
} from "@/lib/email/layout";

/**
 * The preference column a campaign is gated on.
 *
 * Only these two. A campaign is never sent under a security or billing
 * category: those columns exist so a person can keep the messages they must
 * receive and drop the ones they chose to, and borrowing one to reach an
 * audience that switched marketing off is how a product loses the right to
 * send either.
 */
export type CampaignAudience = "email_product_updates" | "email_tips_guides";

export interface CampaignField {
  key: string;
  label: string;
  /** Shown under the input. Say what good input looks like, not what it is. */
  hint?: string;
  placeholder: string;
  multiline?: boolean;
  optional?: boolean;
}

export interface CampaignTemplate {
  id: string;
  name: string;
  /** One line, shown in the picker. */
  description: string;
  audience: CampaignAudience;
  /**
   * True when the message only makes sense on a deployment that sells
   * something. A self-hosted copy with billing switched off should not be
   * offered a template about buying credits.
   */
  billingOnly?: boolean;
  fields: CampaignField[];
  /** The subject line, which the composer also uses as the broadcast title. */
  subject(values: CampaignValues): string;
  /** The body, as the HTML the broadcast content field holds. */
  body(values: CampaignValues): string;
}

export type CampaignValues = Record<string, string>;

/** A field's value, escaped, or its placeholder when the writer left it. */
function val(values: CampaignValues, field: CampaignField): string {
  const raw = values[field.key]?.trim();
  return escapeHtml(raw && raw.length > 0 ? raw : field.placeholder);
}

/** Look a field up by key so a template can read one out of order. */
function fieldValue(
  template: CampaignTemplate,
  values: CampaignValues,
  key: string,
): string {
  const field = template.fields.find((f) => f.key === key);
  if (!field) return escapeHtml(values[key]?.trim() ?? "");
  return val(values, field);
}

/**
 * Split a textarea's lines into list items.
 *
 * Writers type one thing per line because that is what a textarea invites, and
 * the alternative was asking them to hand-write `<li>`. Blank lines are
 * dropped rather than rendered as empty bullets.
 */
function bulletList(raw: string | undefined): string {
  const items = (raw ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0);
  if (items.length === 0) return "";
  return `<ul style="margin:0 0 20px 0;padding-left:20px;">${items
    .map(
      (item) =>
        `<li style="margin:0 0 8px 0;font-size:15px;line-height:1.65;">${escapeHtml(item)}</li>`,
    )
    .join("")}</ul>`;
}

/**
 * A button whose label and destination a writer chose.
 *
 * emailButton escapes the href, because every template that renders one built
 * it from APP_URL plus a server-generated token. It does not escape the label,
 * because no template had ever passed it one a person typed. These two do, and
 * a broadcast reaches every registered account, so the label is escaped here
 * and the path is reduced to the characters a path can hold before it is
 * appended to APP_URL.
 */
function writerButton(
  rawPath: string | undefined,
  rawLabel: string | undefined,
  fallbackPath: string,
  fallbackLabel: string,
): string {
  const path = (rawPath ?? "").trim() || fallbackPath;
  const cleaned = path.replace(/[^A-Za-z0-9\-._~/?=&%#]/g, "");
  const safePath = cleaned.startsWith("/") ? cleaned : "/" + cleaned;
  const label = (rawLabel ?? "").trim() || fallbackLabel;
  return emailButton(APP_URL + safePath, escapeHtml(label));
}

/* ── The templates ──────────────────────────────────────────────────────── */

const RELEASE_NOTES: CampaignTemplate = {
  id: "release-notes",
  name: "Release notes",
  description:
    "A version shipped. What changed, why it matters, and a link to the full changelog.",
  audience: "email_product_updates",
  fields: [
    {
      key: "version",
      label: "Version",
      placeholder: "3.9.0",
      hint: "Just the number. The subject line adds the rest.",
    },
    {
      key: "headline",
      label: "The one-line version",
      placeholder: "Scans stopped reporting things that were not wrong",
      hint: "What a reader should take away if they read nothing else.",
    },
    {
      key: "summary",
      label: "Summary",
      multiline: true,
      placeholder:
        "A dozen checks used to fire on ordinary, correctly configured sites. They no longer do, so the findings left in your report are the ones worth your afternoon.",
    },
    {
      key: "highlights",
      label: "Highlights",
      multiline: true,
      hint: "One per line. Three or four is the right number.",
      placeholder:
        "Missing Referrer-Policy is no longer a finding: every browser since 2020 defaults to a safe policy\nDNSSEC reports one finding per zone instead of three\nGrafana version disclosure compares the version before naming a CVE",
    },
  ],
  subject: (v) =>
    `${APP_NAME} ${v.version?.trim() || "3.9.0"}: ${v.headline?.trim() || "what changed"}`,
  body(values) {
    const version = fieldValue(this, values, "version");
    return `
      ${emailHeading(`What's new in ${version}`)}
      ${emailLead(fieldValue(this, values, "headline"))}
      ${emailParagraph(fieldValue(this, values, "summary"))}
      ${bulletList(values.highlights ?? this.fields[3].placeholder)}
      ${emailButton(`${APP_URL}/dashboard`, "Run a scan")}
      ${emailNote(
        `Every change in this release is written up on the ${emailLink(`${APP_URL}/changelog`, "changelog")}, including the ones that were too small for this email.`,
      )}
    `;
  },
};

const FEATURE_SPOTLIGHT: CampaignTemplate = {
  id: "feature-spotlight",
  name: "Feature spotlight",
  description:
    "One thing the product does that people are not using. What it is, when to reach for it.",
  audience: "email_product_updates",
  fields: [
    {
      key: "feature",
      label: "Feature",
      placeholder: "Scheduled scans",
    },
    {
      key: "problem",
      label: "The problem it solves",
      multiline: true,
      hint: "Start with the reader's situation, not with the feature.",
      placeholder:
        "A clean scan is true on the day you run it. Most regressions arrive with a deploy nobody thought was risky: a header dropped from an nginx config, a cookie that lost its Secure flag in a refactor, a certificate nobody renewed.",
    },
    {
      key: "how",
      label: "How it works",
      multiline: true,
      placeholder:
        "Point a schedule at a URL, pick a frequency, and you get an email when something changes. Not a report every week: a message when the result is different from last time, with the diff in it.",
    },
    {
      key: "ctaLabel",
      label: "Button label",
      placeholder: "Set up a schedule",
    },
    {
      key: "ctaPath",
      label: "Button destination",
      placeholder: "/dashboard",
      hint: "A path on the site, starting with a slash.",
    },
  ],
  subject: (v) =>
    `${v.feature?.trim() || "A feature"} in ${APP_NAME}, and when to use it`,
  body(values) {
    return `
      ${emailHeading(fieldValue(this, values, "feature"))}
      ${emailLead(fieldValue(this, values, "problem"))}
      ${emailParagraph(fieldValue(this, values, "how"))}
      ${writerButton(values.ctaPath, values.ctaLabel, "/dashboard", "Try it")}
      ${emailNote(
        `Not what you needed? The ${emailLink(`${APP_URL}/docs`, "docs")} cover the API, the CLI and the CI integrations, and ${emailLink(`mailto:${SUPPORT_EMAIL}`, "we read every reply")} to this address.`,
      )}
    `;
  },
};

const LAUNCH_ANNOUNCEMENT: CampaignTemplate = {
  id: "launch-announcement",
  name: "Launch announcement",
  description:
    "Something new exists: a integration, an export format, a new surface.",
  audience: "email_product_updates",
  fields: [
    {
      key: "thing",
      label: "What launched",
      placeholder: "A GitHub Action",
    },
    {
      key: "pitch",
      label: "The pitch",
      multiline: true,
      placeholder:
        "Run the same scan your dashboard runs, on every pull request, and fail the build when a new high-severity finding appears. Three lines of YAML, no agent, no runner setup.",
    },
    {
      key: "detail",
      label: "The detail",
      multiline: true,
      optional: true,
      placeholder:
        "It reports against the previous scan of the same URL rather than against an absolute score, so a repository that starts with findings can still gate on not adding more.",
    },
    {
      key: "ctaLabel",
      label: "Button label",
      placeholder: "Read the setup guide",
    },
    {
      key: "ctaPath",
      label: "Button destination",
      placeholder: "/docs",
    },
  ],
  subject: (v) =>
    `New in ${APP_NAME}: ${v.thing?.trim() || "something worth a look"}`,
  body(values) {
    const detail = values.detail?.trim();
    return `
      ${emailHeading(fieldValue(this, values, "thing"))}
      ${emailLead(fieldValue(this, values, "pitch"))}
      ${detail ? emailParagraph(escapeHtml(detail)) : ""}
      ${writerButton(values.ctaPath, values.ctaLabel, "/docs", "Take a look")}
    `;
  },
};

const PROMOTION_OFFER: CampaignTemplate = {
  id: "promotion-offer",
  name: "Offer",
  description:
    "A discount or a credit promotion, with the terms stated rather than implied.",
  audience: "email_product_updates",
  billingOnly: true,
  fields: [
    {
      key: "offer",
      label: "The offer",
      placeholder: "30% off the first year of any plan",
    },
    {
      key: "why",
      label: "Why now",
      multiline: true,
      hint: "A reason beats a countdown. Say what changed or what it is for.",
      placeholder:
        "The scheduled scans, the API and the CI integrations all sit behind a plan, and the fastest way to find out whether they are worth it is to run them against your own stack for a year.",
    },
    {
      key: "code",
      label: "Code",
      optional: true,
      placeholder: "SHIPIT",
      hint: "Leave empty if the price is applied automatically.",
    },
    {
      key: "expires",
      label: "Ends",
      placeholder: "31 October",
      hint: "State a real date. An offer with no end is a price.",
    },
  ],
  subject: (v) => `${v.offer?.trim() || "An offer"} on ${APP_NAME}`,
  body(values) {
    const code = values.code?.trim();
    return `
      ${emailHeading(fieldValue(this, values, "offer"))}
      ${emailLead(fieldValue(this, values, "why"))}
      ${
        code
          ? emailPanel(
              "Code",
              `<p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;letter-spacing:2px;font-weight:600;">${escapeHtml(code)}</p>`,
            )
          : ""
      }
      ${emailButton(`${APP_URL}/pricing`, "See the plans")}
      ${emailNote(
        `Ends ${fieldValue(this, values, "expires")}. Plans are month to month and cancel from the billing page, and the free tier keeps working either way.`,
      )}
      ${emailParagraph(
        `If a plan is not the right shape for what you are doing, reply and say what is. ${emailLink(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL)} reaches a person.`,
      )}
    `;
  },
};

const TEAM_NUDGE: CampaignTemplate = {
  id: "team-nudge",
  name: "You might want a team",
  description:
    "For accounts scanning things that are obviously somebody's shared infrastructure.",
  audience: "email_tips_guides",
  fields: [
    {
      key: "opener",
      label: "Opener",
      multiline: true,
      placeholder:
        "You have been scanning the same handful of hosts for a while, and results that live in one person's account have a way of staying there.",
    },
    {
      key: "pitch",
      label: "What a team changes",
      multiline: true,
      placeholder:
        "A team shares scan history, schedules and findings with the people who would have to fix them. Everyone sees the same result, the same diff between runs, and the same list of what is still open, without anyone forwarding a screenshot.",
    },
  ],
  subject: () => `Sharing ${APP_NAME} results with the people who fix them`,
  body(values) {
    return `
      ${emailHeading("Findings are easier to fix when more than one person can see them")}
      ${emailLead(fieldValue(this, values, "opener"))}
      ${emailParagraph(fieldValue(this, values, "pitch"))}
      ${emailQuote(
        "Roles",
        `<p style="margin:0;font-size:15px;line-height:1.65;">Owner, admin, member and viewer. A viewer reads results and cannot start a scan, which is usually the right level for the person who asked for the report.</p>`,
      )}
      ${emailButton(`${APP_URL}/teams`, "Create a team")}
      ${emailNote(
        "Team seats count against the owner's plan, so check the plan before inviting the whole department.",
      )}
    `;
  },
};

const TIP_GUIDE: CampaignTemplate = {
  id: "tip-guide",
  name: "Tip",
  description:
    "One practical thing, explained properly. The email people forward to a colleague.",
  audience: "email_tips_guides",
  fields: [
    {
      key: "title",
      label: "The tip",
      placeholder: "Your CSP is probably doing nothing",
    },
    {
      key: "setup",
      label: "The situation",
      multiline: true,
      placeholder:
        "A Content-Security-Policy with 'unsafe-inline' in script-src permits exactly the thing a CSP exists to stop, and it is the default in most copy-pasted policies because removing it breaks whatever inline script the page already had.",
    },
    {
      key: "advice",
      label: "What to do",
      multiline: true,
      placeholder:
        "Generate a nonce per request, put it in the policy and on every inline script tag you own. Next.js does this for you in middleware; most frameworks have an equivalent. Then drop 'unsafe-inline' and watch the console for a week with report-only on.",
    },
    {
      key: "snippet",
      label: "Code",
      multiline: true,
      optional: true,
      hint: "Optional. Shown in a monospace block.",
      placeholder:
        "Content-Security-Policy: script-src 'self' 'nonce-{random}' 'strict-dynamic'",
    },
  ],
  subject: (v) => v.title?.trim() || `A ${APP_NAME} tip`,
  body(values) {
    const snippet = values.snippet?.trim();
    return `
      ${emailHeading(fieldValue(this, values, "title"))}
      ${emailLead(fieldValue(this, values, "setup"))}
      ${emailParagraph(fieldValue(this, values, "advice"))}
      ${
        snippet
          ? emailPanel(
              "Example",
              `<pre style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${escapeHtml(snippet)}</pre>`,
            )
          : ""
      }
      ${emailButton(`${APP_URL}/dashboard`, "Check your own site")}
    `;
  },
};

const RE_ENGAGEMENT: CampaignTemplate = {
  id: "re-engagement",
  name: "It has been a while",
  description:
    "For accounts that have not scanned in months. States what changed, once, and stops.",
  audience: "email_product_updates",
  fields: [
    {
      key: "changed",
      label: "What changed since they left",
      multiline: true,
      placeholder:
        "The scanner got quieter. A dozen checks that fired on correctly configured sites no longer do, so a report is now a list of things worth reading rather than a list to triage.",
    },
    {
      key: "hook",
      label: "The reason to come back",
      multiline: true,
      placeholder:
        "Your last scan is still there, and running the same URL again will tell you what has changed since, finding by finding.",
    },
  ],
  subject: () => `Your ${APP_NAME} account, and what changed since`,
  body(values) {
    return `
      ${emailHeading("It has been a while")}
      ${emailLead(fieldValue(this, values, "changed"))}
      ${emailParagraph(fieldValue(this, values, "hook"))}
      ${emailButton(`${APP_URL}/dashboard`, "Scan it again")}
      ${emailNote(
        `If ${APP_NAME} is not for you, the ${emailStrong("Manage email preferences")} link at the bottom switches this off and keeps your account intact.`,
      )}
    `;
  },
};

export const CAMPAIGN_TEMPLATES: readonly CampaignTemplate[] = [
  RELEASE_NOTES,
  FEATURE_SPOTLIGHT,
  LAUNCH_ANNOUNCEMENT,
  PROMOTION_OFFER,
  TEAM_NUDGE,
  TIP_GUIDE,
  RE_ENGAGEMENT,
];

export function getCampaignTemplate(id: string): CampaignTemplate | undefined {
  return CAMPAIGN_TEMPLATES.find((t) => t.id === id);
}

/** Fill a template with its own placeholders, which is what the picker shows. */
export function campaignDefaults(template: CampaignTemplate): CampaignValues {
  return Object.fromEntries(template.fields.map((f) => [f.key, f.placeholder]));
}

/* ── Release notes, built from a release rather than typed ──────────────── */

/**
 * The shape a release announcement needs, which is a subset of the changelog's
 * own Release.
 *
 * Deliberately not `import type { Release }`: lib/changelog/data.ts is five
 * thousand lines and imports sixty lucide icons, and dragging that into the
 * email layer to read four strings would put the whole changelog in every
 * bundle that sends mail. The caller adapts.
 */
export interface ReleaseSummary {
  version: string;
  title: string;
  summary?: string;
  // Optional because the changelog type allows an entry with no category,
  // and the caller should not have to invent one to announce a release.
  changes: { label: string; category?: string }[];
}

/**
 * Pre-fill the release template from a release that is already written.
 *
 * The changelog entry is the considered version of what shipped, written when
 * the change was fresh. Retyping it into a broadcast produces a worse summary
 * every time, so the announcement starts from it: security and fixed entries
 * first, because those are what a reader most wants to know landed.
 */
export function releaseCampaignValues(release: ReleaseSummary): CampaignValues {
  const RANK: Record<string, number> = {
    security: 0,
    added: 1,
    changed: 2,
    fixed: 3,
  };
  const highlights = [...release.changes]
    .sort(
      (a, b) => (RANK[a.category ?? ""] ?? 9) - (RANK[b.category ?? ""] ?? 9),
    )
    .slice(0, 4)
    .map((c) => c.label)
    .join("\n");
  return {
    version: release.version,
    headline: release.title,
    summary: release.summary ?? "",
    highlights,
  };
}
