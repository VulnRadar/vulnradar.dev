import Link from "next/link";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  DocsTable,
  CodeBlock,
  InlineCode,
} from "@/components/docs";
import { AI_MODEL_CATALOG } from "@/lib/ai/model-catalog";
import { AI_CREDIT_TIERS } from "@/lib/billing/ai-credit-catalog";
import {
  CONFIG_BILLING_FREE_AI_TOKENS_PER_WINDOW,
  CONFIG_BILLING_CORE_SUPPORTER_AI_TOKENS_PER_WINDOW,
  CONFIG_BILLING_PRO_SUPPORTER_AI_TOKENS_PER_WINDOW,
  CONFIG_BILLING_ELITE_SUPPORTER_AI_TOKENS_PER_WINDOW,
  CONFIG_AI_USAGE_WINDOW_HOURS,
} from "@/lib/config/config-values";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "vera", label: "The Vera assistant" },
  { id: "endpoints", label: "AI endpoints" },
  { id: "verify", label: "Finding verification" },
  { id: "summary", label: "Scan summaries" },
  { id: "autotag", label: "Auto-tags" },
  { id: "byok", label: "Bring your own key" },
  { id: "budgets", label: "Token budgets" },
  { id: "credits", label: "AI credits" },
  { id: "privacy", label: "Privacy" },
];

export default function AiDocsPage() {
  return (
    <div className="space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="AI"
        title="AI Features"
        description={`${APP_NAME}'s AI is optional and layered on top of a deterministic scanner. Four things use it: the Vera chat assistant, per-finding verification, whole-scan summaries, and auto-tags. Every one resolves the same provider (your own key first, ${APP_NAME}'s managed AI otherwise) and every one degrades to a clean no-op when no AI endpoint is configured.`}
        stats={[
          {
            value: String(AI_MODEL_CATALOG.length),
            label: "supported providers",
          },
          { value: "4", label: "features use AI" },
          { value: "AES-256-GCM", label: "your key, encrypted at rest" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <div className="max-w-[68ch] space-y-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          <p>
            Detection in {APP_NAME} is deterministic: the same URL yields the
            same findings and the same stable IDs, with no model in the loop. AI
            sits on top of that as a set of opt-in conveniences, never as the
            thing that decides whether a finding exists.
          </p>
          <p>
            Four features call a language model:{" "}
            <a
              href="#vera"
              className="text-primary underline-offset-2 hover:underline"
            >
              Vera
            </a>{" "}
            (the support chat widget),{" "}
            <a
              href="#verify"
              className="text-primary underline-offset-2 hover:underline"
            >
              finding verification
            </a>
            ,{" "}
            <a
              href="#summary"
              className="text-primary underline-offset-2 hover:underline"
            >
              scan summaries
            </a>
            , and{" "}
            <a
              href="#autotag"
              className="text-primary underline-offset-2 hover:underline"
            >
              auto-tags
            </a>
            . They all resolve a provider the same way: a user&rsquo;s own key
            if one is configured, otherwise the deployment&rsquo;s managed AI.
            On a self-hosted instance with no{" "}
            <InlineCode>AI_BASE_URL</InlineCode> set, each feature simply does
            nothing rather than erroring.
          </p>
          <p>
            AI is also per-user switchable. Any user can turn it off entirely in
            Profile &gt; AI settings, which hides the chat widget and refuses
            verify and summary calls. Server-side setup (provider, model, key)
            lives in the{" "}
            <Link
              href="/docs/config#ai-models"
              className="text-primary underline-offset-2 hover:underline"
            >
              Configuration reference
            </Link>
            ; this page is about what the features do and how they are gated.
          </p>
        </div>
      </DocsSection>

      <DocsSection id="vera" title="The Vera assistant">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Vera is the floating chat widget in the bottom-right corner (hidden on
          the docs, admin, and live-browser pages). It is scoped to {APP_NAME}
          only: it answers questions about scan findings, how to fix them, API
          usage, and self-hosting, and declines anything off-topic. Sending a
          message requires being signed in; the widget shows a sign-in gate
          otherwise.
        </p>

        <DocsSubSection title="It reads the app's own knowledge">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Vera&rsquo;s system prompt is built from the live codebase, not a
            hand-maintained copy. The scanner-category table and check counts
            come straight from the check registry, alongside the severity
            levels, the per-scan verdict signals (0-10 danger score, safe /
            caution / unsafe rating, engine confidence), the API reference, and
            a set of common findings with their fixes. A few small account facts
            are also baked in: your display name, plan, role, daily scan limit,
            and the month you joined.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Slash commands load context on demand">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            To keep every message small, heavier context is loaded only when you
            ask for it with a slash command. Type <InlineCode>/</InlineCode> in
            the composer for autocomplete.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Public knowledge</strong>:{" "}
              <InlineCode>/docs</InlineCode>,{" "}
              <InlineCode>/changelog</InlineCode>,{" "}
              <InlineCode>/checks</InlineCode>, <InlineCode>/legal</InlineCode>,
              and <InlineCode>/finding {"[id]"}</InlineCode> read the
              app&rsquo;s own generated knowledge files (built by{" "}
              <InlineCode>npm run build:knowledge</InlineCode>). No sign-in
              needed.
            </li>
            <li>
              <strong className="text-foreground">Your own data</strong>:{" "}
              <InlineCode>/history {"[id]"}</InlineCode>,{" "}
              <InlineCode>/me</InlineCode>, and <InlineCode>/stats</InlineCode>{" "}
              pull your scan history, account info, and usage stats straight
              from the database, and require you to be signed in.
            </li>
            <li>
              <strong className="text-foreground">/help</strong> renders the
              command list in the widget itself.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Hardening">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Account facts are passed as a structured data block, not
            interpolated into instruction text, so a display name that looks
            like an instruction is treated as data. Anything you paste in,
            including scan output and scanned page content, is likewise treated
            as untrusted data rather than instructions, because an attacker can
            embed text in a page that later gets scanned.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="endpoints" title="AI endpoints">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The HTTP surface behind the features, all under{" "}
          <InlineCode>{APP_URL}/api/v3/</InlineCode>. Only{" "}
          <InlineCode>/ai/info</InlineCode> is public; the chat and context
          routes require a session.
        </p>

        <DocsTable
          caption="AI-related endpoints, their auth, and what each does"
          columns={[
            {
              key: "method",
              header: "Method",
              className: "font-mono whitespace-nowrap",
            },
            { key: "endpoint", header: "Endpoint", className: "font-mono" },
            { key: "auth", header: "Auth" },
            { key: "what", header: "What it does", className: "w-full" },
          ]}
          data={[
            {
              method: "POST",
              endpoint: "/ai/chat",
              auth: "Session",
              what: "Streams Vera's reply as plain text. Free (not metered against the token cap), 60 messages per user per hour.",
            },
            {
              method: "GET",
              endpoint: "/ai/context",
              auth: "Session",
              what: "Returns the context block for a slash command (docs, checks, your history, your account, and so on).",
            },
            {
              method: "POST",
              endpoint: "/ai/conversations",
              auth: "Optional",
              what: "Persists a chat transcript, linked to your account when you are signed in.",
            },
            {
              method: "GET",
              endpoint: "/ai/conversations",
              auth: "Staff",
              what: "Admin list and read of stored conversations, for support and abuse review.",
            },
            {
              method: "GET",
              endpoint: "/ai/info",
              auth: "Public",
              what: "Whether AI is configured, the active model and provider name, and your AI-disabled flag.",
            },
            {
              method: "POST",
              endpoint: "/scan/verify",
              auth: "Session or key (scan:write)",
              what: "AI-verifies a scan's findings and writes the verdicts back onto the scan.",
            },
            {
              method: "POST",
              endpoint: "/history/{id}/summary",
              auth: "Session or key (scan:write)",
              what: "Generates and caches a plain-language summary of one scan.",
            },
            {
              method: "GET / PUT / DELETE",
              endpoint: "/account/ai-config",
              auth: "Session",
              what: "Read, save, or reset your per-user AI provider config (see Bring your own key).",
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="verify" title="Finding verification">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          <InlineCode>POST /api/v3/scan/verify</InlineCode> takes a scan you own
          and re-checks its findings with the model. For each finding it makes a
          fresh HTTP probe of the target (status code, final URL, response
          headers, and a bounded body snippet) and asks the model whether the
          finding is real given that live evidence. Each finding comes back with
          one of three verdicts, plus a confidence score and a short reason, and
          the enriched findings are written back onto the scan.
        </p>

        <DocsTable
          caption="AI verification verdicts"
          columns={[
            { key: "verdict", header: "Verdict", className: "font-mono" },
            { key: "meaning", header: "What it means", className: "w-full" },
          ]}
          data={[
            {
              verdict: "confirmed",
              meaning: "The live probe supports the finding. Treat it as real.",
            },
            {
              verdict: "possible_fp",
              meaning:
                "The evidence suggests this may be a false positive worth a human look.",
            },
            {
              verdict: "uncertain",
              meaning:
                "The model could not decide either way from the probe. The original finding stands.",
            },
          ]}
        />

        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Auth</strong>: a session cookie,
            or a Bearer API key holding the <InlineCode>scan:write</InlineCode>{" "}
            scope, so a CI pipeline can run verification too. The scan must
            belong to the caller; anything else returns{" "}
            <InlineCode>404</InlineCode>.
          </li>
          <li>
            <strong className="text-foreground">Metered</strong>: unlike chat
            and summaries, verification counts against your plan&rsquo;s{" "}
            <a
              href="#budgets"
              className="text-primary underline-offset-2 hover:underline"
            >
              per-window AI token budget
            </a>
            . A user on their own key bypasses the cap entirely.
          </li>
          <li>
            <strong className="text-foreground">Rate limited</strong>: it shares
            one rate-limit bucket with{" "}
            <InlineCode>/scan/verify-batch</InlineCode>, which runs the same
            per-finding pipeline without persisting. It also honours the
            per-user AI-disabled toggle (<InlineCode>403</InlineCode> when off).
          </li>
        </ul>

        <CodeBlock
          code={`curl -sS -X POST "${APP_URL}/api/v3/scan/verify" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"scanHistoryId": "SCAN_PUBLIC_ID"}'`}
          language="bash"
        />
      </DocsSection>

      <DocsSection id="summary" title="Scan summaries">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          <InlineCode>POST /api/v3/history/{"{id}"}/summary</InlineCode> is the
          whole-scan counterpart to verification: one call that reads the stored
          scan result and returns a short, plain-language write-up. It is
          owner-only and takes the same dual auth (session, or a key with{" "}
          <InlineCode>scan:write</InlineCode>).
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Cached</strong>: the summary is
            stored in the scan&rsquo;s{" "}
            <InlineCode>result_meta.aiSummary</InlineCode>. Reopening it returns
            the cached text with no AI call and no rate-limit cost. Pass{" "}
            <InlineCode>?regenerate=true</InlineCode> to force a fresh one.
          </li>
          <li>
            <strong className="text-foreground">Free</strong>: like chat, it is
            not gated on the token budget. Usage is still recorded for admin
            cost visibility, but it never blocks the request.
          </li>
          <li>
            <strong className="text-foreground">Ask a follow-up</strong>: the
            in-app &quot;Ask about this&quot; control under a summary hands a
            pre-seeded prompt straight to Vera, so the summary and the chat
            share one thread rather than two separate UIs.
          </li>
        </ul>
        <CodeBlock
          code={`curl -sS -X POST "${APP_URL}/api/v3/history/SCAN_PUBLIC_ID/summary" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY"

# Force a regenerate instead of the cached summary
curl -sS -X POST "${APP_URL}/api/v3/history/SCAN_PUBLIC_ID/summary?regenerate=true" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY"`}
          language="bash"
        />
      </DocsSection>

      <DocsSection id="autotag" title="Auto-tags">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Auto-tagging runs automatically at the end of a scan, fire-and-forget,
          and only in one narrow case: when the deterministic rules produced
          exactly <InlineCode>[&quot;Needs Hardening&quot;]</InlineCode>,
          meaning the scan has real findings but none matched any of the roughly
          50 hardcoded tag rules. The model is asked to name the concept those
          leftover findings share.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Minimal input</strong>: the
            model sees only each finding&rsquo;s title, category, and severity,
            never the full evidence, and returns 0 to 2 short Title Case tag
            names.
          </li>
          <li>
            <strong className="text-foreground">
              Never on the critical path
            </strong>
            : it kicks off only after the scan has already completed and is
            visible, so it can be as slow or as unavailable as the provider
            happens to be without affecting the scan. It degrades to a silent
            no-op when no AI is configured or the user disabled AI.
          </li>
          <li>
            <strong className="text-foreground">Sanitized</strong>: raw model
            output is filtered by length, character set, word count, and a
            verb/fragment check, and reserved tags are excluded, before anything
            becomes a tag chip. A line that fails any check is dropped, not
            truncated.
          </li>
          <li>
            <strong className="text-foreground">Free</strong>: not metered
            against the token budget (the prompt is tiny by construction),
            though usage is recorded. A separate admin path can promote a
            recurring AI tag into a permanent, deterministic rule.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="byok" title="Bring your own key">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Profile &gt; AI settings offers three modes, backed by{" "}
          <InlineCode>/api/v3/account/ai-config</InlineCode>: use {APP_NAME}
          &rsquo;s managed AI (the default), bring your own provider key, or
          turn AI off entirely.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Provider and model</strong> are
            chosen from a fixed catalog and validated server-side; an unknown
            provider or model is rejected.
          </li>
          <li>
            <strong className="text-foreground">
              The base URL is never taken from the client.
            </strong>{" "}
            It always comes from the catalog entry for the selected provider,
            because the stored base URL is later used to make outbound calls
            with your key; accepting an arbitrary URL would be an SSRF vector.
          </li>
          <li>
            <strong className="text-foreground">
              Your key is encrypted at rest
            </strong>{" "}
            with AES-256-GCM (the same scheme used for API keys). Only the last
            four characters are ever returned to the UI.
          </li>
          <li>
            <strong className="text-foreground">
              Own key means no metering.
            </strong>{" "}
            When you use your own provider, every AI feature bypasses {APP_NAME}
            &rsquo;s token budget, and calls go straight to your provider.
          </li>
        </ul>

        <DocsSubSection title="Supported providers">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Straight from the AI model catalog. Each provider ships a small set
            of vetted models; see the{" "}
            <Link
              href="/docs/config#ai-models"
              className="text-primary underline-offset-2 hover:underline"
            >
              Configuration reference
            </Link>{" "}
            for the per-model context and output limits.
          </p>
          <DocsTable
            caption="AI providers available for bring-your-own-key, from lib/ai/model-catalog.ts"
            columns={[
              { key: "provider", header: "Provider" },
              { key: "count", header: "Models" },
              { key: "example", header: "Example models", className: "w-full" },
            ]}
            data={AI_MODEL_CATALOG.map((p) => ({
              provider: p.name,
              count: String(p.models.length),
              example: p.models
                .slice(0, 3)
                .map((m) => m.label)
                .join(", "),
            }))}
          />
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="budgets" title="Token budgets">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          When you use {APP_NAME}&rsquo;s managed AI, the metered features draw
          from a per-plan token budget that refills on a fixed window. Finding
          verification (and GitHub repo review) are metered against it; chat,
          scan summaries, and auto-tags are free and never counted against the
          cap, though their usage is still recorded for cost visibility.
          Bringing your own key removes the cap entirely.
        </p>

        <DocsTable
          caption="AI tokens per window by plan, from lib/config/config-values.ts"
          columns={[
            { key: "plan", header: "Plan" },
            {
              key: "tokens",
              header: "AI tokens per window",
              className: "w-full",
            },
          ]}
          data={[
            {
              plan: "Free",
              tokens: CONFIG_BILLING_FREE_AI_TOKENS_PER_WINDOW.toLocaleString(),
            },
            {
              plan: "Core Supporter",
              tokens:
                CONFIG_BILLING_CORE_SUPPORTER_AI_TOKENS_PER_WINDOW.toLocaleString(),
            },
            {
              plan: "Pro Supporter",
              tokens:
                CONFIG_BILLING_PRO_SUPPORTER_AI_TOKENS_PER_WINDOW.toLocaleString(),
            },
            {
              plan: "Elite Supporter",
              tokens:
                CONFIG_BILLING_ELITE_SUPPORTER_AI_TOKENS_PER_WINDOW.toLocaleString(),
            },
          ]}
        />

        <DocsCallout
          variant="info"
          title={`Fixed ${CONFIG_AI_USAGE_WINDOW_HOURS}-hour window`}
        >
          <p>
            The budget resets on a fixed window anchored to the Unix epoch, not
            a rolling one. The default length is {CONFIG_AI_USAGE_WINDOW_HOURS}{" "}
            hours and is admin-configurable via{" "}
            <InlineCode>AI_USAGE_WINDOW_HOURS</InlineCode> (see{" "}
            <Link
              href="/docs/config"
              className="text-primary underline-offset-2 hover:underline"
            >
              Configuration
            </Link>
            ). Usage is counted from the provider&rsquo;s real token report when
            it gives one, and from a character-length estimate otherwise.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="credits" title="AI credits">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          AI credits are a one-time top-up bought at{" "}
          <InlineCode>/checkout/credits</InlineCode> (a single Stripe payment,
          not a subscription). They are a fallback, not a substitute: a call the
          plan&rsquo;s free per-window allowance already covers never touches
          credits, and only the portion of a call that lands above the ceiling
          is charged against the balance. The balance carries over between
          windows; it only goes up on a purchase and down on spend.
        </p>

        <DocsTable
          caption="AI credit tiers, from lib/billing/ai-credit-catalog.ts"
          columns={[
            { key: "price", header: "Price" },
            { key: "tokens", header: "Tokens" },
            { key: "rate", header: "Tokens per dollar", className: "w-full" },
          ]}
          data={AI_CREDIT_TIERS.map((t) => {
            const dollars = t.priceInCents / 100;
            return {
              price: `$${dollars}`,
              tokens: t.tokens.toLocaleString(),
              rate: Math.round(t.tokens / dollars).toLocaleString(),
            };
          })}
        />
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The rate climbs with the tier, so a bigger top-up is worth more per
          dollar. Crediting is idempotent across the two paths that can confirm
          a payment, and a refunded or disputed charge claws the remaining
          balance back (floored at zero).
        </p>
      </DocsSection>

      <DocsSection id="privacy" title="Privacy">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          What the model sees is scoped tightly to the feature, and no more than
          the feature needs.
        </p>

        <DocsTable
          caption="What each AI feature sends to the model"
          columns={[
            { key: "feature", header: "Feature" },
            { key: "sees", header: "What it sees", className: "w-full" },
          ]}
          data={[
            {
              feature: "Vera chat",
              sees: "The system prompt (public product knowledge plus small account facts: your name, plan, role, daily scan limit, join month), your messages, and any context you explicitly load with a slash command.",
            },
            {
              feature: "Finding verification",
              sees: "One finding at a time, plus a fresh probe of the target: status code, final URL, response headers, and a bounded body snippet.",
            },
            {
              feature: "Scan summaries",
              sees: "The stored result for that one scan.",
            },
            {
              feature: "Auto-tags",
              sees: "Only finding titles, categories, and severities. Never full evidence.",
            },
          ]}
        />

        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Where it goes</strong>: with the
            managed AI, calls go to the deployment&rsquo;s configured provider.
            With your own key, calls go directly to your chosen provider and
            nothing is metered against your plan.
          </li>
          <li>
            <strong className="text-foreground">Your key</strong> is encrypted
            at rest (AES-256-GCM) and used only when analyzing sites you submit.
          </li>
          <li>
            <strong className="text-foreground">Untrusted by default</strong>:
            scanned page content and anything you paste into chat are handled as
            data, not instructions.
          </li>
          <li>
            <strong className="text-foreground">Off switch</strong>: turning AI
            off in Profile &gt; AI settings hides the chat widget and refuses
            verify and summary calls for your account.
          </li>
        </ul>

        <DocsCallout variant="warning" title="AI can be wrong">
          <p>
            Model output is a convenience, not the source of truth. The
            findings, IDs, and severities come from the deterministic scanner;
            verify anything critical against the finding itself rather than the
            summary or the verdict.
          </p>
        </DocsCallout>
      </DocsSection>
    </div>
  );
}
