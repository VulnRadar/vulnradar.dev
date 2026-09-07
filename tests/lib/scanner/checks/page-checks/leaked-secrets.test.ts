import { describe } from "vitest";
import { leakedSecretChecks } from "@/lib/scanner/checks/page-checks/leaked-secrets";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-presigned-url-aws-exposed": [
    {
      description: "a real S3 pre-signed URL rendered into the page",
      body: '<a href="https://acme-reports.s3.us-east-1.amazonaws.com/q3.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA3XZQ7PLMN4RTUVWY%2F20260907%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260907T101500Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=c9f1a4b2e7d03f8916aa5c4be2107d3f9b8e6a1c50d47f23ba9e18c6d5074f3a">Q3 report</a>',
      expect: "fire",
      evidenceIncludes: "pre-signed URL",
    },
    {
      description: "documentation naming the parameters is not a signature",
      body: "<p>Sign the request and pass X-Amz-Signature and X-Amz-Credential in the query string.</p>",
      expect: "skip",
    },
    {
      description: "a placeholder in a code sample",
      body: "<code>?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F...&X-Amz-Signature=&lt;your-signature&gt;</code>",
      expect: "skip",
    },
    {
      description: "a plain public object URL",
      body: '<img src="https://acme-assets.s3.amazonaws.com/logo.png">',
      expect: "skip",
    },
  ],

  "page-presigned-url-azure-sas-exposed": [
    {
      description: "a SAS whose permission string includes write and delete",
      body: '<a href="https://acmestore.blob.core.windows.net/private/invoice.pdf?sv=2024-11-04&ss=b&srt=sco&sp=rwdlacx&se=2027-01-01T00:00:00Z&spr=https&sig=Xy8%2BqL4mN7pRs9TvWx1YzA3BcD5EfG7HiJ9KlM1NoP4%3D">Invoice</a>',
      expect: "fire",
      evidenceIncludes: "write or delete",
    },
    {
      description: "a plain blob URL with no signature",
      body: '<img src="https://acmestore.blob.core.windows.net/public/logo.png">',
      expect: "skip",
    },
    {
      description: "sv must be a date and sig must be long enough to be one",
      body: '<a href="https://acmestore.blob.core.windows.net/x/y?sv=1&sig=abc">x</a>',
      expect: "skip",
    },
  ],

  "page-presigned-url-gcs-exposed": [
    {
      description: "a v4 signed Cloud Storage URL",
      body: '<a href="https://storage.googleapis.com/acme-private/export.csv?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=svc%40acme.iam.gserviceaccount.com%2F20260907%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Expires=604800&X-Goog-SignedHeaders=host&X-Goog-Signature=3f2b8c1d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c">Export</a>',
      expect: "fire",
      evidenceIncludes: "signed URL",
    },
    {
      description: "a public object URL",
      body: '<img src="https://storage.googleapis.com/acme-public/logo.png">',
      expect: "skip",
    },
    {
      description: "a tutorial placeholder",
      body: "<code>?X-Goog-Signature=SIGNATURE&X-Goog-Credential=CREDENTIAL</code>",
      expect: "skip",
    },
  ],

  "page-url-embedded-credentials": [
    {
      description:
        "an internal artifact feed wired in with a password in the URL",
      body: '<a href="https://svc-report:S3cr3tP%40ss@files.acme.test/nightly.zip">nightly build</a>',
      expect: "fire",
      evidenceIncludes: "files.acme.test",
    },
    {
      description: "a port is not a password",
      body: '<a href="https://api.acme.test:8443/v1/status">status</a>',
      expect: "skip",
    },
    {
      description: "userinfo with no password half",
      body: '<a href="https://user@example.com/">profile</a>',
      expect: "skip",
    },
    {
      description: "a mailto is not an http URL",
      body: '<a href="mailto:ops@acme.test">ops</a>',
      expect: "skip",
    },
  ],

  "page-inline-script-high-entropy-secret": [
    {
      description: "high-entropy value assigned to a secret-shaped variable",
      body: `<script>var apiSecretKey = "Tg7QkP2mZ9qX4wR8vL1nB6yH3jF5dS0c";</script>`,
      expect: "fire",
      evidenceIncludes: "apiSecretKey",
    },
    {
      description: "placeholder value is not flagged",
      body: `<script>var apiSecretKey = "your_api_key_here_replace_me_now";</script>`,
      expect: "skip",
    },
    {
      description: "short value below the length threshold",
      body: `<script>var apiKey = "short123";</script>`,
      expect: "skip",
    },
    {
      description: "low-entropy repeated-character value",
      body: `<script>var authToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";</script>`,
      expect: "skip",
    },
    {
      description: "non-secret-shaped variable name is not flagged",
      body: `<script>var greetingMessage = "Tg7kP2mZ9qX4wR8vL1nB6yH3jF5dS0c1";</script>`,
      expect: "skip",
    },
  ],
};

describe("page-checks/leaked-secrets", () => {
  runPageCheckTests(leakedSecretChecks, fixtures);
});
