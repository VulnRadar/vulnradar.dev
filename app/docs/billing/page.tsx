import Link from "next/link";

import { APP_NAME, BILLING_ENABLED } from "@/lib/config/constants";
import { PLANS, PRODUCTS } from "@/lib/billing/catalog";
import { AI_CREDIT_TIERS } from "@/lib/billing/ai-credit-catalog";
import { GITHUB_CREDIT_TIERS } from "@/lib/billing/github-credit-catalog";
import { BROWSERBASE_CREDIT_TIERS } from "@/lib/billing/browserbase-credit-catalog";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  DocsTable,
  InlineCode,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "plans", label: "What each plan includes" },
  { id: "upgrading", label: "Upgrading and downgrading" },
  { id: "credits", label: "Credits" },
  { id: "cancelling", label: "Cancelling and reactivating" },
  { id: "lapses", label: "Failed payments and lapses" },
  { id: "refunds", label: "Refunds" },
  { id: "self-hosted", label: "Self-hosted instances" },
];

/** `-1` is the unlimited sentinel and `0` means the feature is not on that plan. */
function limitLabel(value: number): string {
  if (value === -1) return "Unlimited";
  if (value === 0) return "Not included";
  return value.toLocaleString();
}

/**
 * Read off the catalog rather than restated, because the discount constant
 * itself is module-private: a yearly product's price against twelve of its
 * plan's monthly price is the same number, and it cannot go stale.
 */
function yearlyDiscountPercent(): number {
  const yearly = PRODUCTS.find((product) => product.interval === "year");
  const plan = PLANS.find((p) => p.id === yearly?.planId);
  if (!yearly || !plan || plan.priceInCents === 0) return 0;
  return Math.round((1 - yearly.priceInCents / (plan.priceInCents * 12)) * 100);
}

function priceLabel(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })}`;
}

const LIMIT_ROWS: {
  key: keyof (typeof PLANS)[number]["limits"];
  label: string;
}[] = [
  { key: "dailyScans", label: "Scans per day" },
  { key: "concurrentScans", label: "Scans running at once" },
  { key: "bulkScanUrls", label: "URLs per bulk scan" },
  { key: "crawlPages", label: "Pages one crawl may scan" },
  { key: "scheduledScans", label: "Scheduled scans" },
  { key: "apiKeys", label: "API keys" },
  { key: "apiRequestsPerDay", label: "API requests per day" },
  { key: "webhooks", label: "Webhooks" },
  { key: "teams", label: "Teams" },
  { key: "teamMembers", label: "Members per team" },
  { key: "aiTokensPerWindow", label: "AI tokens per window" },
  {
    key: "githubReviewTokensPerWindow",
    label: "Repo-review tokens per window",
  },
  {
    key: "browserbaseMinutesPerMonth",
    label: "Live-browser minutes per month",
  },
];

export default function BillingDocsPage() {
  const planColumns = [
    { key: "limit", header: "Limit", className: "whitespace-nowrap" },
    ...PLANS.map((plan) => ({ key: plan.id, header: plan.name })),
  ];

  const planRows = LIMIT_ROWS.map((row) => {
    const cells: Record<string, string> = { limit: row.label };
    for (const plan of PLANS) cells[plan.id] = limitLabel(plan.limits[row.key]);
    return cells;
  });

  const yearlyPercent = yearlyDiscountPercent();

  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Account"
        title="Plans and Billing"
        description={`What each plan raises, how to change plan, how the three credit balances work, and exactly what happens when you cancel or a payment fails. Every number below is read from ${APP_NAME}'s own plan catalog at build time, so this page cannot drift from what the app enforces.`}
        stats={[
          { value: String(PLANS.length), label: "Plans" },
          { value: `${yearlyPercent}%`, label: "Off when billed yearly" },
          { value: "3", label: "Credit balances" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <p className="text-sm leading-relaxed text-muted-foreground">
          The detection engine is identical on every plan, down to the check
          IDs. Paying does not unlock checks or a better scanner; it raises
          volume limits and unlocks the collaboration and automation features in
          the table below. That is deliberate, and it is why the free tier is
          worth using on its own.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Two things are billed separately from your plan. Your{" "}
          <strong className="text-foreground">plan</strong> is a monthly or
          yearly subscription.{" "}
          <strong className="text-foreground">Credits</strong> are one-off
          purchases that top up three specific metered features (AI, repo
          review, live browser sessions) once that plan&rsquo;s included
          allowance for the period is spent. You never need credits to scan.
        </p>
        <DocsCallout
          variant="info"
          title="Nothing is deleted when you downgrade"
        >
          <p>
            Scan history retention is unlimited on every plan, including free.
            Dropping to a lower plan does not delete scans, keys, webhooks, or
            schedules you already have: it stops you creating new ones past the
            lower plan&rsquo;s limit. The over-limit check runs at creation
            time, not as a sweep over what exists.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="plans" title="What each plan includes">
        <div className="flex flex-col gap-3 sm:flex-row">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="flex-1 rounded-lg border border-border/50 bg-card/50 p-4"
            >
              <div className="text-sm font-semibold text-foreground">
                {plan.name}
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-primary">
                {priceLabel(plan.priceInCents)}
                {plan.priceInCents > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">
                    /month
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {plan.description}
              </p>
            </div>
          ))}
        </div>

        <DocsTable
          caption="Every per-plan limit the application enforces"
          columns={planColumns}
          data={planRows}
        />

        <p className="text-sm leading-relaxed text-muted-foreground">
          &ldquo;Unlimited&rdquo; in that table is the{" "}
          <InlineCode>-1</InlineCode> sentinel the code uses, and &ldquo;Not
          included&rdquo; is <InlineCode>0</InlineCode>. The AI, repo-review and
          live-browser rows are deliberately finite on every plan, including the
          top one: those three run on metered third-party capacity rather than
          our own compute, so no tier is an unbounded budget. Bringing your own
          AI key bypasses the two token caps entirely instead of raising them,
          which is covered on the{" "}
          <Link
            href="/docs/ai"
            className="text-primary underline-offset-2 hover:underline"
          >
            AI Features
          </Link>{" "}
          page.
        </p>

        <DocsSubSection title="Monthly or yearly">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every paid plan is sold on both intervals: {PRODUCTS.length}{" "}
            purchasable products in total. Yearly is {yearlyPercent}% cheaper
            than twelve monthly payments of the same plan. The limits are
            identical either way; the interval only changes when you are
            charged.
          </p>
        </DocsSubSection>

        <DocsCallout
          variant="info"
          title="An operator can change these numbers"
        >
          <p>
            On a self-hosted instance every limit above is an admin setting, not
            a hard-coded constant. The values shown here are the shipped
            defaults; the running instance reads its own settings, so a
            self-hosted deployment can raise or lower any of them without
            touching the code. See the{" "}
            <Link
              href="/docs/administration"
              className="text-primary underline-offset-2 hover:underline"
            >
              Administration
            </Link>{" "}
            page.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="upgrading" title="Upgrading and downgrading">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Pick a plan on <InlineCode>/pricing</InlineCode> and choose monthly or
          yearly. That takes you to a checkout page which collects payment
          through Stripe; card details are entered in Stripe&rsquo;s own hosted
          fields and never reach our servers. The new limits apply as soon as
          Stripe confirms the payment.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Moving between paid plans works the same way: choose the other plan
          and check out. Invoices, receipts, and your saved payment method live
          in the Stripe billing portal, reachable from{" "}
          <InlineCode>Profile &rarr; Billing</InlineCode> under &ldquo;Manage
          billing&rdquo;.
        </p>
        <DocsCallout
          variant="info"
          title="There is no free trial of a paid plan"
        >
          <p>
            The free tier is the trial. It is not time-limited, it needs no
            card, and it runs the same engine, so you can find out whether the
            scanner is useful before any money changes hands.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="credits" title="Credits">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Three features meter usage because each one costs real money per call
          to a third party. Each has an allowance included with your plan, and
          each has a matching credit balance you can top up. Credits are spent
          only after the included allowance for that period is gone, they are a
          one-off purchase rather than a subscription, and they do not expire
          with the billing period.
        </p>

        <DocsTable
          caption="The three credit balances, what each one pays for, and when it is spent"
          columns={[
            { key: "credit", header: "Credit" },
            { key: "pays", header: "Pays for", className: "w-full" },
            { key: "included", header: "Included allowance" },
          ]}
          data={[
            {
              credit: "AI tokens",
              pays: "AI finding verification and AI scan summaries, once the window allowance is gone. Vera chat draws on the same window counter but never spends this balance.",
              included: "Per fixed window, by plan",
            },
            {
              credit: "Repo-review tokens",
              pays: "Whole-repository AI code review on a connected GitHub repo. Metered separately because one review is far larger than one chat message.",
              included: "Per fixed window, by plan",
            },
            {
              credit: "Live-browser minutes",
              pays: "Interactive browser sessions used for authenticated scanning. Billed in minutes of session time.",
              included: "Per calendar month, by plan",
            },
          ]}
        />

        <DocsSubSection title="What a top-up costs">
          <DocsTable
            caption="Credit top-up tiers currently sold"
            columns={[
              { key: "kind", header: "Credit" },
              { key: "tier", header: "Tier" },
              { key: "price", header: "Price" },
            ]}
            data={[
              ...AI_CREDIT_TIERS.map((tier) => ({
                kind: "AI tokens",
                tier: `${tier.tokens.toLocaleString()} tokens`,
                price: priceLabel(tier.priceInCents),
              })),
              ...GITHUB_CREDIT_TIERS.map((tier) => ({
                kind: "Repo review",
                tier: `${tier.tokens.toLocaleString()} tokens`,
                price: priceLabel(tier.priceInCents),
              })),
              ...BROWSERBASE_CREDIT_TIERS.map((tier) => ({
                kind: "Live browser",
                tier: `${tier.minutes.toLocaleString()} minutes`,
                price: priceLabel(tier.priceInCents),
              })),
            ]}
          />
          <p className="text-sm leading-relaxed text-muted-foreground">
            All three are bought from{" "}
            <InlineCode>Profile &rarr; Billing</InlineCode>, which shows the
            current balance beside each buy button. A purchase is credited once
            and only once: if the confirmation and the Stripe webhook both
            arrive, the second one is ignored rather than doubling your balance.
          </p>
        </DocsSubSection>

        <DocsCallout
          variant="warning"
          title="A refunded or disputed purchase is reversed"
        >
          <p>
            If a credit purchase is fully refunded or charged back, the credits
            it bought are removed from the balance, floored at zero so a spent
            balance cannot go negative. A partial refund is recorded but does
            not remove credits.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="cancelling" title="Cancelling and reactivating">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Cancel from <InlineCode>Profile &rarr; Billing</InlineCode>. There are
          two options and they behave differently, so pick deliberately.
        </p>

        <DocsTable
          caption="The two cancellation options and what each one does"
          columns={[
            { key: "option", header: "Option" },
            { key: "effect", header: "What happens", className: "w-full" },
          ]}
          data={[
            {
              option: "Cancel at period end",
              effect:
                "Stripe stops renewing, and you keep every paid limit until the current period runs out. The account shows as canceling until then, and the plan drops to free when the period ends. This is the reversible one.",
            },
            {
              option: "Cancel immediately",
              effect:
                "The subscription ends now, the plan drops to free immediately, and the remainder of the period is not refunded. Not reversible: starting again means a new subscription.",
            },
          ]}
        />

        <p className="text-sm leading-relaxed text-muted-foreground">
          While a subscription is in the{" "}
          <strong className="text-foreground">canceling</strong> state a
          Reactivate button appears in the same place. Reactivating clears the
          scheduled cancellation and keeps the existing subscription, so there
          is no new charge and no gap: you are simply billed as normal at the
          next renewal.
        </p>

        <DocsCallout variant="info" title="Cancelling never deletes anything">
          <p>
            Your scans, findings, API keys, webhooks, schedules and team
            memberships all survive a cancellation. You return to free-tier
            limits, which means you cannot create more of the things the free
            tier caps, but nothing you already have is removed. To delete your
            data, use the account deletion and data-export controls described on
            the{" "}
            <Link
              href="/docs/account-security"
              className="text-primary underline-offset-2 hover:underline"
            >
              Account Security
            </Link>{" "}
            page.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="lapses" title="Failed payments and lapses">
        <p className="text-sm leading-relaxed text-muted-foreground">
          A failed renewal does not immediately drop you to free. The account is
          marked past due and you get an email, but paid limits stay in place
          while Stripe retries the charge, because a card that expired on a
          Friday should not cost you your scheduled scans over the weekend.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          If the retries eventually fail and Stripe ends the subscription, the
          plan drops to free and a cancellation email goes out. If a retry
          succeeds instead, the account goes straight back to active and a
          receipt is recorded in your billing history. Update the card in the
          Stripe billing portal from{" "}
          <InlineCode>Profile &rarr; Billing</InlineCode> to end the retry cycle
          early.
        </p>
      </DocsSection>

      <DocsSection id="refunds" title="Refunds">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Purchases are final. The free tier exists so you can find out whether
          the tool works for you before paying, and cancelling immediately does
          not refund the remainder of the period. If something has gone wrong
          with a charge, open a support ticket rather than a chargeback: a
          dispute automatically claws back any credits the payment bought, which
          is worse for you than a conversation.
        </p>
        <DocsCallout variant="info" title="Where the policy lives">
          <p>
            The refund position is stated on the pricing page and repeated in
            the cancellation dialog. Payment processing, card handling and what
            billing data is retained are covered in the{" "}
            <Link
              href="/legal/privacy"
              className="text-primary underline-offset-2 hover:underline"
            >
              privacy policy
            </Link>
            .
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="self-hosted" title="Self-hosted instances">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Billing is a feature of the hosted service, not a requirement of the
          software.{" "}
          {BILLING_ENABLED
            ? "It is enabled on this deployment."
            : "It is disabled on this deployment, so everything on this page is background information rather than something you will see."}{" "}
          When billing is turned off, every account resolves to unlimited plan
          limits, the pricing and checkout pages say there is nothing to buy,
          and upgrade prompts disappear.
        </p>
        <DocsCallout
          variant="warning"
          title="Turning it off has a runtime half and a build-time half"
        >
          <p>
            The admin toggle takes effect for limit enforcement within the
            settings cache window, with no redeploy. The user-interface half
            (the pricing page, the nav link, upgrade prompts, the checkout
            guards) and the Stripe client itself read the value compiled into
            the build, so a deployment that should never show billing at all
            wants <InlineCode>CONFIG_BILLING_ENABLED=false</InlineCode> set
            before the build, not just the admin toggle flipped afterwards.
          </p>
        </DocsCallout>
      </DocsSection>
    </div>
  );
}
