import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  API_KEY_LIMIT_MESSAGE,
  BULK_STOPPED_MESSAGE,
  DAILY_LIMIT_MESSAGE,
} from "@/lib/scanner/failure-messages";
import { SCANNER_UA_PRODUCT } from "@/lib/scanner/user-agent";

/**
 * Each of these is a sentence that was wrong, or a section a reader could not
 * find, on a page nothing type-checks. They read source text because that is
 * what the assistant's compiled knowledge is built from too.
 */
const read = (file: string) => readFileSync(file, "utf8");
const flat = (file: string) => read(file).replace(/\s+/g, " ");
const prose = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");

describe("every table of contents entry has a target", () => {
  it.each([
    "app/docs/sharing/page.tsx",
    "app/docs/troubleshooting/page.tsx",
    "app/docs/triage/page.tsx",
    "app/docs/ai/page.tsx",
    "app/docs/scanning/page.tsx",
    "app/docs/account-security/page.tsx",
  ])("%s", (file) => {
    const source = read(file);
    const toc = source.slice(0, source.indexOf("export default function"));
    const ids = [...toc.matchAll(/id: "([a-z-]+)",\s+label/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(source, `${file} has no section with id ${id}`).toMatch(
        new RegExp(`id="${id}"`),
      );
    }
  });
});

describe("/docs/sharing site-owner controls", () => {
  const page = flat("app/docs/sharing/page.tsx");

  it("has the anchor the public report pages link to", () => {
    expect(page).toContain('id="domain-owner-controls"');
    expect(page).toContain('title="Verified domains and site-owner controls"');
  });

  it("does not call a share link private when it is listed by default", () => {
    expect(page).not.toContain("Only people you give the URL to");
    expect(page).toContain("listed in the directory below unless you turn");
  });

  it("says what a staff block answers", () => {
    expect(page).toContain("A staff block cannot be lifted here");
    expect(page).toContain("<InlineCode>409</InlineCode>");
  });

  it("does not claim Unpublish takes a scan off the directory", () => {
    const source = read("lib/domains/owner-control.ts");
    expect(source).toContain("gated on share_token rather than on is_public");
    expect(page).toContain(
      "it is the share link that puts a scan in the Public Scans directory",
    );
  });
});

describe("/docs/troubleshooting", () => {
  const page = flat("app/docs/troubleshooting/page.tsx");

  it("renders the bulk and quota messages from the strings the pipeline stores", () => {
    expect(page).toContain("message: DAILY_LIMIT_MESSAGE");
    expect(page).toContain("message: API_KEY_LIMIT_MESSAGE");
    expect(page).toContain("message: BULK_STOPPED_MESSAGE");
    expect(page).toContain(
      "bulkDeadlineMessage(CONFIG_BULK_SCAN_TIMEOUT_SECONDS)",
    );
    for (const m of [
      DAILY_LIMIT_MESSAGE,
      API_KEY_LIMIT_MESSAGE,
      BULK_STOPPED_MESSAGE,
    ]) {
      expect(m.length).toBeGreaterThan(0);
    }
  });

  it("lists the literal messages the read boundary passes through", () => {
    const boundary = read("lib/api/scan-error-message.ts");
    for (const message of [
      "Scan failed to start.",
      "An unexpected error occurred during the scan.",
      "An unexpected error occurred during the crawl scan.",
      "The scan ran past its time limit and was stopped.",
    ]) {
      expect(boundary).toContain(message);
      expect(page).toContain(`message: "${message}"`);
    }
  });

  it("separates a staff block from an owner block", () => {
    expect(page).toContain("A staff block");
    expect(page).toContain("An owner block");
    expect(page).toContain("DELETE /domains/");
  });

  it("documents the scanner's User-Agent from the shared constants", () => {
    expect(page).toContain('id="recognising-traffic"');
    expect(page).toContain("{SCANNER_UA_PRODUCT}");
    expect(page).toContain("agent: SCANNER_UA,");
    expect(page).toContain("does not publish its scan IP addresses");
    expect(page).toContain("browser&rsquo;s own User-Agent");
    expect(SCANNER_UA_PRODUCT).toMatch(/\/1\.0$/);
  });

  it("has the shorter page title", () => {
    expect(read("app/docs/troubleshooting/layout.tsx")).toContain(
      'title: "Troubleshooting Scans: Failures and Empty Results"',
    );
  });
});

describe("/docs home first scan", () => {
  const page = flat("app/docs/page.tsx");

  it("does not send portScan in the first request", () => {
    expect(page).toContain(`'{"url": "example.com"}'`);
    expect(page).not.toContain('"portScan": true}');
    expect(page).toContain("It needs a verified domain");
  });

  it("shows the real response, the poll and the findings", () => {
    expect(page).toContain('"scanId": 12345');
    expect(page).toContain('"status": "running"');
    expect(page).toContain("/api/v3/scan/status/12345");
    expect(page).toContain("every 2 to 5 seconds");
    expect(page).toContain("hsts-missing--9f2c1a");
  });

  it("gives the real path to a key and takes the counts from the plans", () => {
    expect(page).toContain("Profile > Developer > API Keys");
    expect(page).toContain("${API_KEY_ALLOWANCE}");
    expect(page).not.toContain("1 on Free");
  });

  it("says the docs are English only", () => {
    expect(page).toContain("These docs are in English only.");
  });
});

describe("/docs/ai", () => {
  const page = prose("app/docs/ai/page.tsx");

  it("scopes determinism to URL scans and counts five features", () => {
    expect(page).toContain("Detection on a URL scan is deterministic");
    expect(page).toContain("Five features call a language model");
    expect(page).toContain('value: "5"');
    expect(page).not.toContain("Four features");
    expect(page).not.toContain("Four things");
  });

  it("documents repo review, its label and its budget", () => {
    expect(page).toContain('id="github-review"');
    expect(page).toContain("AI code review");
    expect(page).toContain("githubReviewTokensPerWindow");
  });

  it("says answers follow the account language, as the chat route does", () => {
    expect(page).toContain("It answers in your account language.");
    expect(read("app/api/v3/ai/chat/route.ts")).toContain(
      "LOCALE_ENGLISH_NAMES",
    );
  });
});

describe("/docs/reports SARIF", () => {
  const page = flat("app/docs/reports/page.tsx");

  it("uses the finding id, as the exporter does", () => {
    const exporter = read("lib/reports/sarif-report.ts");
    expect(exporter).toContain("ruleId: finding.id");
    expect(exporter).toContain("vulnradarFindingId: finding.id");
    expect(page).toContain('"ruleId": "hsts-missing--9f2c1a"');
    expect(page).toContain('"vulnradarFindingId": "hsts-missing--9f2c1a"');
    expect(page).toContain("one entry per finding id");
    expect(page).toContain(
      "the check id, two dashes, and a short hash of the scanned URL",
    );
    expect(page).toContain("hsts-missing--</InlineCode>");
  });

  it("shows the real version and describes security-severity honestly", () => {
    expect(page).toContain('"version": "${APP_VERSION}"');
    expect(page).not.toContain('"version": "3.x"');
    expect(page).toContain("not a per-instance assessment");
  });

  it("points CI at the Action's sarif-file output and keeps curl", () => {
    expect(read(".github/actions/scan-gate/action.yml")).toContain(
      "sarif-file:",
    );
    expect(page).toContain("steps.vulnradar.outputs.sarif-file");
    expect(page).toContain("Without the Action: fetch it with curl");
  });

  it("links the false-positive anchor and the check catalogue", () => {
    expect(page).toContain('href="/docs/triage#false-positives"');
    expect(page).toContain('href="/checks"');
  });
});

describe("/docs/triage", () => {
  const page = flat("app/docs/triage/page.tsx");

  it("explains the verdicts under the anchor reports links to", () => {
    expect(page).toContain('id="false-positives"');
    for (const verdict of ["False positive", "Confirmed", "Not applicable"]) {
      expect(page).toContain(`verdict: "${verdict}"`);
    }
    expect(page).toContain("POST /scan/feedback");
  });

  it("says an AI suggestion hides nothing until you mark it yourself", () => {
    expect(page).toContain("Only a verdict you give yourself does any of this");
    expect(page).toContain(
      "still counts in the score and still fails the CI gate until you mark it",
    );
  });

  it("warns that remediation is private to you", () => {
    expect(page).toContain(
      "Remediation is a personal checklist, not a team task board",
    );
  });

  it("links the check catalogue", () => {
    expect(page).toContain('href="/checks"');
  });
});

describe("/docs/teams", () => {
  const page = flat("app/docs/teams/page.tsx");

  // Keyed on the route rather than on the sentence alone, because the transfer
  // is built after this page was corrected and the two have to change together.
  it("says what the teams route really does about ownership transfer", () => {
    const hasTransfer = read("app/api/v3/teams/route.ts").includes(
      "newOwnerId",
    );
    if (hasTransfer) {
      expect(page).not.toContain("There is no ownership transfer");
    } else {
      expect(page).not.toContain("must transfer or delete");
      expect(page).toContain("There is no ownership transfer");
    }
  });

  it("says staff keep a higher paid or gifted plan", () => {
    expect(page).not.toContain("treated as the Pro Supporter plan");
    expect(page).toContain(
      "Staff accounts get at least the Pro Supporter plan here, not unlimited; a higher paid or gifted plan is kept.",
    );
  });

  it("calls the assignee a private label", () => {
    expect(page).not.toContain("hand a remediation item");
    expect(page).toContain("It is a private label");
  });

  it("links the check catalogue", () => {
    expect(page).toContain('href="/checks"');
  });
});

describe("/docs/account-security", () => {
  const page = flat("app/docs/account-security/page.tsx");
  const notifications = flat(
    "components/profile/tabs/profile-notifications-tab.tsx",
  );

  it("uses the tab names on the screen", () => {
    expect(page).toContain(">Social</strong>");
    expect(page).toContain("Profile &gt; Social");
    expect(page).not.toContain("Connections");
  });

  it("says what deleting does to a subscription, and who cannot delete", () => {
    expect(page).toContain(
      "Every live Stripe subscription on the account is cancelled at once rather than at the end of its period",
    );
    expect(page).toContain(
      "if Stripe cannot confirm that, the account is kept and you are asked to try again in a minute",
    );
    expect(page).toContain("a super admin cannot delete their own account");
  });

  it("says where Sign out everywhere really is", () => {
    expect(page).toContain("sits at the top right of Active sessions");
    expect(page).not.toContain("danger-zone button");
  });

  it.each([
    "Security alerts",
    "New sign-ins",
    "Password changes",
    "Two-step verification changes",
    "Revoked sessions",
  ])("labels %s as the notifications tab does", (label) => {
    expect(notifications).toContain(`label: "${label}"`);
    expect(page).toContain(`category: "${label}"`);
  });

  it("does not claim more emails are translated than are", () => {
    expect(read("lib/email/email.ts").match(/getTranslator\(/g)).toHaveLength(
      1,
    );
    expect(page).toContain(
      "sign-up verification email goes out in your account language",
    );
  });
});

describe("/docs/billing", () => {
  const page = flat("app/docs/billing/page.tsx");

  it("explains when each limit resets", () => {
    expect(page).toContain('title="Reading this table"');
    expect(page).toContain("reset at 00:00 UTC");
    expect(page).toContain("{CONFIG_AI_USAGE_WINDOW_HOURS} hours");
    expect(page).toContain("reset each calendar month");
  });

  it("shows the Free trial review from the setting", () => {
    expect(page).toContain(
      "One trial review per ${CONFIG_GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS} hours",
    );
  });
});

describe("/docs/scheduled-scans", () => {
  const page = flat("app/docs/scheduled-scans/page.tsx");

  it("warns that schedules spend the daily quota, in the Frequencies section", () => {
    const section = page.slice(
      page.indexOf('id="frequencies"'),
      page.indexOf('id="timezone"'),
    );
    expect(section).toContain('title="Schedules share your quota"');
    expect(section).toContain("resets 00:00 UTC");
    expect(section).toContain("that run is skipped");
  });
});
