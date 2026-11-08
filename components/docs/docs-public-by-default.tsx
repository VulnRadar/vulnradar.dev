import { DocsCallout } from "./docs-callout";
import { InlineCode } from "./docs-code-block";

/**
 * The privacy default a reader most needs before a first scan, said once so the
 * three pages that carry it (the docs home, /docs/sharing and
 * /docs/account-security) cannot drift apart. The switch names are the ones on
 * the screen, and tests/app/docs/privacy-default-callout.test.ts reads them from
 * the profile tab and the scan form's messages.
 */
export function DocsPublicByDefault() {
  return (
    <DocsCallout variant="warning" title="New scans are public by default">
      <p>
        A finished scan publishes a read-only snapshot at{" "}
        <InlineCode>/host/&lt;hostname&gt;</InlineCode> unless you turn it off.{" "}
        <strong className="text-foreground">
          Profile &gt; Privacy &gt; Scans are public by default
        </strong>{" "}
        switches that off for new scans, and{" "}
        <strong className="text-foreground">Keep this scan private</strong> on
        the scan form does it for one scan. Sharing a scan with a link also
        lists it in the Public Scans directory by default (
        <strong className="text-foreground">
          Profile &gt; Privacy &gt; List new shares in the Public Scans
          directory
        </strong>
        ).
      </p>
    </DocsCallout>
  );
}
