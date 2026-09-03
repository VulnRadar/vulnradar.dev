import Link from "next/link";
import { APP_NAME } from "@/lib/config/constants";
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

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "two-factor", label: "Two-step verification" },
  { id: "authenticator-app", label: "Authenticator app", level: 2 },
  { id: "email-codes", label: "Email codes", level: 2 },
  { id: "backup-codes", label: "Backup codes", level: 2 },
  { id: "sessions", label: "Sessions and trusted devices" },
  { id: "active-sessions", label: "Active sessions", level: 2 },
  { id: "trusted-devices", label: "Trusted devices", level: 2 },
  { id: "sign-out-everywhere", label: "Sign out everywhere", level: 2 },
  { id: "oauth", label: "Sign in with Google, GitHub, Discord" },
  { id: "notifications", label: "Notifications and posture digest" },
  { id: "data", label: "Your data and privacy" },
  { id: "export", label: "Export your data", level: 2 },
  { id: "scan-privacy", label: "Scan and share privacy", level: 2 },
  { id: "deletion", label: "Delete your account", level: 2 },
];

export default function AccountSecurityDocsPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Account"
        title="Account Security"
        description={`Everything that hardens your ${APP_NAME} account and controls what it keeps about you: two-step verification, the devices and sessions that can sign in, which social logins are attached, the emails you get, and how to pull your data out or delete the account entirely. All of it lives under Profile, this page is the map.`}
        stats={[
          { value: "2", label: "2FA methods" },
          { value: "8", label: "Backup codes" },
          { value: "30 days", label: "Trusted-device window" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <div className="max-w-[68ch] space-y-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          <p>
            Your password is the floor, not the ceiling. On its own it means a
            single leaked or reused credential is enough to sign in as you.
            Everything below sits on top of it: a second factor so a stolen
            password is not enough, a session list so you can see and cut off
            anything you do not recognise, and privacy controls over what a scan
            leaves behind and what {APP_NAME} stores.
          </p>
          <p>
            Every control here is under{" "}
            <Link
              href="/profile"
              className="text-primary underline-offset-2 hover:underline"
            >
              Profile
            </Link>
            , split across four tabs:{" "}
            <strong className="text-foreground">Security</strong> (password,
            two-step verification, sessions),{" "}
            <strong className="text-foreground">Connections</strong> (social
            logins), <strong className="text-foreground">Notifications</strong>{" "}
            (which emails you get), and{" "}
            <strong className="text-foreground">Privacy</strong> (data export,
            scan visibility, account deletion). Changing anything sensitive asks
            for your current password again, so a hijacked session alone cannot
            quietly rewire your security.
          </p>
        </div>
      </DocsSection>

      <DocsSection id="two-factor" title="Two-step verification">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Two-step verification (2FA) asks for a second code after your password
          at sign-in. {APP_NAME} offers two methods and you run one at a time: a
          rotating code from an authenticator app, or a code emailed to you.
          Turning either one on, off, or switching between them asks for your
          current password first. To switch, turn the active method off, then
          turn the other on.
        </p>

        <DocsCallout variant="info" title="Pick the app method if you can">
          <p>
            An authenticator app is the stronger of the two: the code is
            generated on your device and works with no signal, and it is not
            exposed if your email account is compromised. Email codes are only
            as safe as the inbox they land in. Use email codes when you cannot
            keep an authenticator app, not as the default.
          </p>
        </DocsCallout>

        <DocsSubSection id="authenticator-app" title="Authenticator app (TOTP)">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Works with Google Authenticator, Authy, 1Password, or any other TOTP
            app. In{" "}
            <strong className="text-foreground">Profile &gt; Security</strong>,
            under Two-step verification, choose{" "}
            <InlineCode>Set up authenticator app</InlineCode> and follow the two
            steps:
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-sm leading-relaxed text-muted-foreground marker:text-primary">
            <li>
              <strong className="text-foreground">Scan.</strong> Point your app
              at the QR code, or type the shown key in by hand if you cannot
              scan. The app starts showing a 6-digit code for {APP_NAME} that
              changes every 30 seconds.
            </li>
            <li>
              <strong className="text-foreground">Verify.</strong> Enter the
              current 6-digit code plus your account password. The password step
              is what stops someone with only a borrowed session from enrolling
              their own device. Get it right and 2FA is on, and your backup
              codes appear once.
            </li>
          </ol>
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The secret that seeds those codes is stored encrypted at rest
            (AES-256-GCM), and the server refuses to set up app 2FA at all
            unless that encryption key is configured, so a database read never
            yields a usable seed. If a code is rejected, it is almost always
            because the 30-second window rolled over: use the one showing right
            now. Turning the app method off later also asks for your password
            and deletes both the enrolled secret and every backup code.
          </p>
        </DocsSubSection>

        <DocsSubSection id="email-codes" title="Email codes">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Simpler to set up and nothing to install. In{" "}
            <strong className="text-foreground">Profile &gt; Security</strong>,
            choose <InlineCode>Turn on email codes</InlineCode> and confirm your
            password. After that, every sign-in sends a fresh 6-digit code to
            your account email, which you enter to finish signing in. There are
            no backup codes for this method, because access to your inbox is
            already the recovery path. Turning it off asks for your password
            again.
          </p>
        </DocsSubSection>

        <DocsSubSection id="backup-codes" title="Backup codes">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            When you turn on the authenticator-app method, {APP_NAME} issues{" "}
            <strong className="text-foreground">eight</strong> single-use backup
            codes. Each one signs you in exactly once if you lose your phone, so
            they are the difference between a lost device and a lost account.
            They are shown a single time. Copy or download them then, and keep
            them somewhere that is not the phone running the authenticator.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              Each code looks like{" "}
              <InlineCode>ABCDE-12345-FGHIJ-67890</InlineCode> and works only
              once. Using one consumes it.
            </li>
            <li>
              {APP_NAME} stores only a hash of each code, never the code itself,
              so nobody, staff included, can read them back to you. Lose them
              and your only route back in is the authenticator app.
            </li>
            <li>
              The Security tab shows how many are left (for example{" "}
              <InlineCode>3 of 8 left</InlineCode>). When you are running low,
              use <InlineCode>New codes</InlineCode> and confirm your password
              to issue a fresh set. Generating a new set immediately invalidates
              the old one.
            </li>
            <li>
              Backup codes exist only for the authenticator-app method. The
              email method does not use them.
            </li>
          </ul>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="sessions" title="Sessions and trusted devices">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A session is one signed-in browser or device. A trusted device is one
          that has already cleared 2FA and is allowed to skip the second-factor
          prompt for a while. Both are listed and revocable in{" "}
          <strong className="text-foreground">Profile &gt; Security</strong>,
          and they are the fastest way to answer &quot;is anyone else in my
          account&quot;.
        </p>

        <DocsSubSection id="active-sessions" title="Active sessions">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The Active sessions list shows every device currently signed in: a
            summary of the browser and OS, the IP address, and when it signed
            in. The one you are on is tagged{" "}
            <strong className="text-foreground">This device</strong>. Anything
            you do not recognise, sign it out with one click.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">IPv4 for IPv6 logins:</strong>{" "}
              when your connection came in over IPv6, the list also shows a
              usable IPv4 address for that session where it could be captured,
              so the address is something you can actually recognise rather than
              a long IPv6 string.
            </li>
            <li>
              <strong className="text-foreground">
                You cannot single-out your current session:
              </strong>{" "}
              signing out the device you are on is what &quot;Sign out
              everywhere&quot; is for. Every other session can be revoked
              individually, and doing so ends it immediately.
            </li>
            <li>
              <strong className="text-foreground">
                Nothing replayable is exposed:
              </strong>{" "}
              the list never contains the real session token. Revoking works
              through an opaque identifier that only resolves to your own
              sessions, so the list cannot be used to touch anyone else&apos;s.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="trusted-devices" title="Trusted devices">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            At the 2FA prompt you can tick{" "}
            <strong className="text-foreground">remember this device</strong>.
            That device then skips the second-factor code on future sign-ins for{" "}
            <strong className="text-foreground">30 days</strong> (the default),
            after which it has to pass 2FA again. Do this only on hardware you
            control, never on a shared or public machine.
          </p>
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Every remembered device shows up under Trusted devices with its
            name, IP, and when it was last used. Remove one and its next sign-in
            has to clear 2FA from scratch. The token that marks a device as
            trusted is held in a locked-down cookie and is never shown in the
            list, so the page can flag which row is &quot;this device&quot;
            without ever handing out a credential that skips your second factor.
          </p>
        </DocsSubSection>

        <DocsSubSection id="sign-out-everywhere" title="Sign out everywhere">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The danger-zone button at the bottom of the Security tab ends every
            session on every device, including the one you are using. Reach for
            it if you think someone else has access: it drops you back at the
            sign-in page and forces your password (and 2FA) again everywhere. If
            Session Alerts are on, you also get an email confirming it happened.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="oauth" title="Sign in with Google, GitHub, Discord">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          You can sign in with Google, GitHub, or Discord instead of, or
          alongside, a password. On a first sign-in through a provider,{" "}
          {APP_NAME} creates an account for you automatically. Which buttons
          appear depends on the deployment: a provider only shows up once the
          operator has configured it, so a self-hosted instance may offer fewer
          than the hosted one.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Link a provider</strong> to an
            account you already have from{" "}
            <strong className="text-foreground">
              Profile &gt; Connections
            </strong>
            . Linking Google or GitHub lets you use that button next time in
            addition to your password. Discord has its own connect flow on the
            same tab.
          </li>
          <li>
            <strong className="text-foreground">Unlink</strong> a provider from
            the same place when you no longer want it attached. If a provider is
            the only way into your account, set a password first so you do not
            lock yourself out.
          </li>
          <li>
            <strong className="text-foreground">No password yet?</strong> An
            account created purely through a provider has no password on file.
            The Security tab lets you add one, which is worth doing so a
            provider outage never becomes a lockout.
          </li>
        </ul>
        <DocsCallout
          variant="info"
          title="Signing in is not the same as sharing scans"
        >
          <p>
            A social login only authenticates you. It does not post anything to
            the provider and does not change who can see your scans, that is
            governed entirely by the privacy settings below.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="notifications" title="Notifications and posture digest">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          {APP_NAME} talks to you in two places: the in-app bell (the
          notification centre, for things like team invites and announcements)
          and email. Which emails you get is entirely up to you, set in{" "}
          <strong className="text-foreground">
            Profile &gt; Notifications
          </strong>
          . The security-related categories are the ones worth leaving on.
        </p>

        <DocsTable
          caption="Security and account email categories and what each one tells you"
          columns={[
            { key: "category", header: "Category" },
            { key: "tells", header: "What it tells you", className: "w-full" },
            { key: "default", header: "Default" },
          ]}
          data={[
            {
              category: "Security Alerts",
              tells:
                "Unusual activity and account-compromise warnings. This is how you find out about access you did not grant, so it stays on regardless.",
              default: "Always on",
            },
            {
              category: "Login Alerts",
              tells: "A sign-in from a new device or location.",
              default: "On",
            },
            {
              category: "Password Changes",
              tells: "Your password was changed or a reset was requested.",
              default: "On",
            },
            {
              category: "2FA Changes",
              tells:
                "Two-step verification was turned on, off, or its backup codes were regenerated.",
              default: "On",
            },
            {
              category: "Session Alerts",
              tells: "Sessions were revoked, including a sign-out-everywhere.",
              default: "On",
            },
            {
              category: "Posture Digest",
              tells:
                "A periodic summary across every site you have scanned. Opt-in, see below.",
              default: "Off",
            },
          ]}
        />

        <DocsSubSection title="The weekly posture digest">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The posture digest is the one email that looks across your whole
            account instead of a single scan. Once a week it rolls up every site
            you have scanned into one message: new critical and high findings
            since last time, and whether your open-issue count is trending up or
            down. It is{" "}
            <strong className="text-foreground">off by default</strong> and
            never turns itself on, flip the Posture Digest toggle under
            Notifications to start receiving it. Findings you have marked as
            false positives are left out, so the trend line reflects real work.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="data" title="Your data and privacy">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          {APP_NAME} encrypts your data at rest and in transit and handles it
          under GDPR and other applicable data-protection law. The controls for
          seeing, restricting, and removing that data are in{" "}
          <strong className="text-foreground">Profile &gt; Privacy</strong>. For
          the full policy, see the{" "}
          <Link
            href="/legal/privacy"
            className="text-primary underline-offset-2 hover:underline"
          >
            Privacy Policy
          </Link>
          .
        </p>

        <DocsSubSection id="export" title="Export your data">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Export your data</strong> on the
            Privacy tab downloads a single JSON file with everything tied to
            your account: profile, sessions, trusted devices, API keys and their
            usage logs, scan history and findings, tags, webhooks, teams,
            billing history, notifications, and more. It is the fastest and most
            complete answer to &quot;what do you actually hold about me&quot;.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">A 30-day cooldown</strong>{" "}
              applies between fresh exports (the operator can change this on a
              self-hosted instance). The tab shows when the next one is
              available.
            </li>
            <li>
              <strong className="text-foreground">
                Your last export stays available
              </strong>{" "}
              to re-download with no cooldown, so you never have to burn a fresh
              request just to grab the file again.
            </li>
            <li>
              <strong className="text-foreground">Secrets are left out</strong>{" "}
              by design. Password hash, the 2FA seed, backup codes, and any
              encrypted provider or API tokens are never included in the export.
            </li>
          </ul>
          <CodeBlock
            language="text"
            code={`Profile > Privacy > Export your data > Download now
  -> vulnradar-data-export-YYYY-MM-DD.json`}
          />
        </DocsSubSection>

        <DocsSubSection id="scan-privacy" title="Scan and share privacy">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Two independent defaults on the Privacy tab control how visible your
            scanning is. Both have per-scan and per-share overrides, so a
            default never traps you.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Scan visibility.</strong> By
              default a completed scan writes a snapshot to a public page at{" "}
              <InlineCode>/host/&lt;hostname&gt;</InlineCode>. Turn off{" "}
              <InlineCode>Scans are public by default</InlineCode> to keep new
              scans private unless you say otherwise, either per scan on the
              scan form or from a scan&apos;s own menu afterwards.
            </li>
            <li>
              <strong className="text-foreground">
                Public Scans directory.
              </strong>{" "}
              Separately, when you share a scan, the share link can be listed in
              the public{" "}
              <Link
                href="/public-scans"
                className="text-primary underline-offset-2 hover:underline"
              >
                Public Scans
              </Link>{" "}
              directory. Turn off{" "}
              <InlineCode>
                List new shares in Public Scans by default
              </InlineCode>{" "}
              to keep new share links off that directory. The link still works
              for anyone you send it to, it just is not browsable by strangers.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="deletion" title="Delete your account">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The danger zone at the bottom of the Privacy tab permanently deletes
            your account and everything attached: API keys, scan history,
            exports, and the rest. To confirm you type{" "}
            <InlineCode>DELETE</InlineCode> and re-enter your password (an
            account with no password, created through a provider, skips the
            password step). The purge runs as one transaction, and there is no
            recovery afterwards.
          </p>
          <DocsCallout
            variant="warning"
            title="Deletion is immediate and final"
          >
            <p>
              There is no grace period or undo once the purge runs. If you only
              want to step away, sign out everywhere and turn off email
              categories instead of deleting, then export your data first if you
              might want it later.
            </p>
          </DocsCallout>
        </DocsSubSection>
      </DocsSection>
    </div>
  );
}
