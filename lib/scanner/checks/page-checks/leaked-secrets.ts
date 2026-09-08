/**
 * Entropy-scored secret detection in inline JavaScript.
 *
 * `checks/secrets-extended.ts` already carries roughly 50 fixed patterns
 * (one per vendor token format: AWS, Stripe, GitHub, and so on). Those stay
 * useful for the formats they know. This check instead looks at the
 * *shape* of an assignment: an identifier that reads like a secret, assigned
 * a string literal that is long and high-entropy. It catches vendor formats
 * nobody has written a pattern for yet, at the cost of being a heuristic, so
 * its confidence is deliberately capped well below a fixed-format match.
 *
 * Scope: inline <script> content only (`ctx.inlineScript`). Linked scripts
 * are not fetched here; that would require the network layer this module
 * does not own. This is a passive check: it reads text already present in
 * the response, nothing is executed or requested.
 */

import type { PageCheck } from "../../check-types";
import { excerpt, lineAt } from "../../check-types";
import { redactSecret } from "../../_helpers";

const ASSIGNMENT =
  /\b([a-zA-Z_$][a-zA-Z0-9_$]{0,40})\s*[:=]\s*["']([A-Za-z0-9_\-+/=]{20,120})["']/g;

const SECRET_NAME =
  /(?:api|secret|private|access|auth|client)[_-]?(?:key|token|secret)|password|passwd|token$/i;

// Real placeholders are usually phrases ("your_api_key_goes_here",
// "REPLACE_WITH_YOUR_KEY"), not single words, so this matches on the
// telltale substring rather than requiring the whole value to be one.
const PLACEHOLDER =
  /your[_-]?(?:api[_-]?)?key|insert[_-]?(?:your[_-]?)?key|key[_-]?(?:goes[_-]?)?here|replace[_-]?(?:with|me)\b|change[_-]?me|^(?:x+|0+|1+)$|^(?:test|demo|sample|example|placeholder|dummy|fake|mock)(?:[_-][a-z]+)?$/i;

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** True when the string is mostly one repeated character or a short cycle. */
function looksLikePlaceholder(value: string): boolean {
  if (PLACEHOLDER.test(value)) return true;
  const unique = new Set(value.toLowerCase()).size;
  return unique <= 3;
}

export const leakedSecretChecks: PageCheck[] = [
  {
    id: "page-inline-script-high-entropy-secret",
    title:
      "High-entropy value assigned to a secret-shaped variable in inline script",
    category: "secrets-extended",
    severity: "high",
    method: "script-analysis",
    confidence: 55,
    description:
      "An inline script assigns a long, high-entropy string literal to a variable whose name looks like it holds an API key, token, or password.",
    riskImpact:
      "If this value is a real credential, anyone who views the page source has it. Client-side JavaScript cannot keep a secret: it is delivered in full to every visitor's browser.",
    explanation:
      "This is a shape-and-entropy heuristic, not a match against a known vendor token format: it flags identifiers matching /key|secret|token|password/ assigned a 20+ character value with high character diversity. It will miss low-entropy secrets and can flag high-entropy non-secrets (hashes, generated IDs). Verify the actual value before treating this as confirmed.",
    fixSteps: [
      "Move the credential to a server-side environment variable and proxy the API call through your own backend.",
      "If the value is meant to be public (a publishable key, a public client ID), rename the variable so it does not read as a secret, or add it to an allowlist.",
      "Rotate the credential if it is real and was actually exposed.",
    ],
    codeExamples: [],
    needs: ["scripts"],
    run(ctx) {
      if (!ctx.inlineScript) return null;
      const seen = new Set<string>();
      const excerpts: ReturnType<typeof excerpt>[] = [];
      const names: string[] = [];
      let m: RegExpExecArray | null;
      ASSIGNMENT.lastIndex = 0;
      while ((m = ASSIGNMENT.exec(ctx.inlineScript))) {
        const [full, name, value] = m;
        if (!SECRET_NAME.test(name)) continue;
        if (looksLikePlaceholder(value)) continue;
        if (shannonEntropy(value) < 3.5) continue;
        const key = `${name}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(name);
        excerpts.push(
          excerpt(
            name,
            `${name} = "${redactSecret(value)}"`,
            lineAt(ctx.body, ctx.body.indexOf(full)),
          ),
        );
        if (excerpts.length >= 10) break;
      }
      if (excerpts.length === 0) return null;
      return {
        evidence: `${excerpts.length} secret-shaped, high-entropy value(s) assigned in inline script: ${names.join(", ")}.`,
        excerpts,
      };
    },
  },
  {
    id: "page-presigned-url-aws-exposed",
    title: "AWS pre-signed S3 URL exposed in page source",
    category: "information-disclosure",
    severity: "high",
    method: "body-pattern",
    description:
      "The page contains an S3 pre-signed URL, which is a bearer credential in a query string: anyone who reads the page has the signer's access to that object until the signature expires.",
    riskImpact:
      "A pre-signed URL needs no account and no header. Whoever holds the link has exactly the access the signature granted, to anyone they pass it to, for the whole expiry window, and teams routinely sign for the seven-day maximum because it is the value that stops links breaking. Nothing about the object is protected by the bucket's own policy once a signature for it is in public HTML.",
    explanation:
      "S3 pre-signing moves authorisation out of a header and into the query string so a browser can fetch a private object directly. That makes it a credential shaped like a link, which is why it ends up rendered into pages: it looks like a URL. The signature cannot be revoked short of rotating the signing key or deleting the object.",
    fixSteps: [
      "Sign for minutes rather than days: an expiry long enough for the fetch, not for the session.",
      "Generate the URL from an authenticated endpoint at the moment it is needed, rather than rendering it into the page for every visitor.",
      "Treat any signature already published as leaked: rotate the signing credential and, if the object is sensitive, replace it.",
    ],
    codeExamples: [
      {
        label: "A short expiry, fetched when needed",
        language: "javascript",
        code: "// Not rendered into the page: returned by an endpoint that checks the caller.\nconst url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), {\n  expiresIn: 300, // five minutes\n});",
      },
    ],
    references: [
      "https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html",
    ],
    run(ctx) {
      // Both halves are required. The 64-hex signature alone could be any
      // hash; the credential alone appears in documentation. Together they are
      // the shape only a real signing produces.
      const sig = ctx.body.match(/[?&]X-Amz-Signature=([0-9a-f]{64})\b/i);
      if (!sig) return null;
      const cred = ctx.body.match(
        /[?&]X-Amz-Credential=(?!AKIAIOSFODNN7EXAMPLE)[A-Z0-9]{16,}(?:%2F|\/)/i,
      );
      if (!cred) return null;
      const expires = ctx.body.match(/[?&]X-Amz-Expires=(\d+)/i);
      const window = expires
        ? ` The signature is valid for ${Math.round(Number(expires[1]) / 3600)} hours.`
        : "";
      return {
        evidence: `An S3 pre-signed URL is rendered into the page.${window}`,
        excerpts: [
          excerpt(
            "Signature",
            `X-Amz-Signature=${sig[1].slice(0, 12)}...`,
            lineAt(ctx.body, sig.index ?? 0),
          ),
        ],
      };
    },
  },

  {
    id: "page-presigned-url-azure-sas-exposed",
    title: "Azure Storage SAS token exposed in page source",
    category: "information-disclosure",
    severity: "high",
    method: "body-pattern",
    description:
      "The page contains an Azure Storage shared access signature, which grants whoever reads it the permissions encoded in the token until it expires.",
    riskImpact:
      "A SAS states its own permissions in the sp parameter, and the ones that include write, delete, add or create do not just leak the object: they let any reader of the page overwrite it, delete it, or add new blobs to the container. A read-only signature is a disclosure; a writable one is control of the storage account's data for the life of the token.",
    explanation:
      "A shared access signature is a query string that carries a service version, a permission set, an expiry and an HMAC over the rest. It authorises by itself, with no account and no header, which is why publishing one is publishing the access. Revoking it before expiry requires rotating the account key or the stored access policy it was issued against.",
    fixSteps: [
      "Issue user-delegation SAS tokens with a short expiry, from an endpoint that checks the caller, instead of rendering one into the page.",
      "Grant read only unless a write is genuinely being performed by the browser.",
      "Issue against a stored access policy, which is the only way to revoke a signature before it expires.",
    ],
    codeExamples: [
      {
        label: "Read-only, minutes not days",
        language: "javascript",
        code: "const sas = generateBlobSASQueryParameters({\n  containerName, blobName,\n  permissions: BlobSASPermissions.parse('r'),\n  expiresOn: new Date(Date.now() + 5 * 60_000),\n}, credential);",
      },
    ],
    references: [
      "https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview",
    ],
    run(ctx) {
      // Two passes, not one pattern, and the reason is backtracking.
      //
      // The single pattern this replaces had two unbounded [^\s"'<>]* runs
      // with a [?&] between them, and ? and & are both inside that class. So
      // on a body of repeated "?sv=2020-01-01" the engine tried every split
      // point between the two runs: a crafted 256KB page took 9.2 seconds in
      // one check, against a scanner whose whole job is to fetch pages chosen
      // by somebody else. That is a denial of service with the target holding
      // the trigger.
      //
      // Finding the candidate URL is one bounded greedy class with nothing
      // ambiguous after it, so it is linear. The two required parameters are
      // then tested against that candidate on their own, where neither can
      // interact with the other.
      let m: RegExpMatchArray | null = null;
      for (const candidate of ctx.body.matchAll(
        /https?:\/\/[a-z0-9-]{3,63}\.(?:blob|file|queue|table|dfs)\.core\.windows\.net\/[^\s"'<>]{0,2048}/gi,
      )) {
        const url = candidate[0];
        if (!/[?&]sv=\d{4}-\d{2}-\d{2}/i.test(url)) continue;
        if (!/[?&]sig=[A-Za-z0-9%+/=]{40,}/i.test(url)) continue;
        m = candidate;
        break;
      }
      if (!m) return null;
      const permissions = m[0].match(/[?&]sp=([a-z]+)/i)?.[1] ?? "";
      const writable = /[wdac]/i.test(permissions);
      const host = m[0].slice(0, m[0].indexOf("/", 8));
      return {
        evidence: writable
          ? `An Azure Storage SAS on ${host} grants "${permissions}", which includes write or delete access, and it is rendered into the page.`
          : `An Azure Storage SAS on ${host} is rendered into the page.`,
        excerpts: [
          excerpt(
            "SAS",
            `${host}/... sp=${permissions || "(unstated)"}`,
            lineAt(ctx.body, m.index ?? 0),
          ),
        ],
      };
    },
  },

  {
    id: "page-presigned-url-gcs-exposed",
    title: "Google Cloud Storage signed URL exposed in page source",
    category: "information-disclosure",
    severity: "high",
    method: "body-pattern",
    description:
      "The page contains a Cloud Storage signed URL, which grants whoever reads it the signer's access to that object until the signature expires.",
    riskImpact:
      "The signature authorises on its own, with no credentials, for anyone the link reaches, until it expires. The signing identity is usually a service account with broader object access than the one object being shared, and its identity is written into the URL, so a leaked signature also tells an attacker which service account to go looking for elsewhere.",
    explanation:
      "V4 signing puts the credential, the expiry and an RSA-SHA256 signature into the query string so a browser can fetch a private object directly. Publishing one publishes the access it grants. There is no revocation short of rotating the service account key.",
    fixSteps: [
      "Sign for the length of the fetch, not the length of the session.",
      "Return the URL from an authenticated endpoint rather than rendering it into HTML every visitor receives.",
      "Rotate the signing service account key for any signature that has already been published.",
    ],
    codeExamples: [
      {
        label: "A signature that expires in minutes",
        language: "javascript",
        code: "const [url] = await file.getSignedUrl({\n  version: 'v4',\n  action: 'read',\n  expires: Date.now() + 5 * 60_000,\n});",
      },
    ],
    references: [
      "https://cloud.google.com/storage/docs/access-control/signed-urls",
    ],
    run(ctx) {
      const sig = ctx.body.match(/[?&]X-Goog-Signature=([0-9a-f]{64,})/i);
      if (!sig) return null;
      if (!/[?&]X-Goog-Credential=/i.test(ctx.body)) return null;
      return {
        evidence:
          "A Cloud Storage signed URL is rendered into the page, granting the signer's access to anyone who reads it.",
        excerpts: [
          excerpt(
            "Signature",
            `X-Goog-Signature=${sig[1].slice(0, 12)}...`,
            lineAt(ctx.body, sig.index ?? 0),
          ),
        ],
      };
    },
  },

  {
    id: "page-url-embedded-credentials",
    title: "URL with an embedded username and password in page source",
    category: "information-disclosure",
    severity: "high",
    method: "body-pattern",
    description:
      "A link, script or form target carries credentials in the URL itself, in the https://user:password@host form.",
    riskImpact:
      "The password is in the page, so it is in every browser cache that holds the page, every proxy log that records the URL, the referrer of anything the link opens, and any copy of the source a person shares. It is also almost always a credential for something internal, because the userinfo form is what people reach for when wiring an internal service or a protected artifact feed into a page quickly.",
    explanation:
      "The userinfo component of a URL predates every modern auth mechanism and browsers have been narrowing it for years, but it still works enough of the time to be used. Nothing about it is secret: it travels in the URL, which is the one part of a request that gets logged everywhere.",
    fixSteps: [
      "Remove the credential from the URL and authenticate the request properly, with a header or a session.",
      "Treat the password as compromised and rotate it: it has been served to everyone who loaded this page.",
      "If the resource is meant to be public, drop the credential entirely.",
    ],
    codeExamples: [
      {
        label: "Authenticate with a header, not with the URL",
        language: "javascript",
        code: "// Not: fetch('https://svc:s3cret@internal.example.com/report')\nawait fetch('https://internal.example.com/report', {\n  headers: { Authorization: `Bearer ${token}` },\n});",
      },
    ],
    references: [
      "https://developer.mozilla.org/en-US/docs/Web/URI/Authority#user_information",
    ],
    run(ctx) {
      const m = ctx.body.match(
        /\bhttps?:\/\/([A-Za-z0-9._~%!$&'()*+,;=-]{1,64}):([A-Za-z0-9._~%!$&'()*+,;=-]{1,64})@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i,
      );
      if (!m) return null;
      // An all-digit second half is a port, not a password: https://host:8443
      // has no userinfo at all, and the @ came from somewhere else on the line.
      if (/^\d+$/.test(m[2])) return null;
      return {
        evidence: `A URL embeds credentials for ${m[3]}: user "${m[1]}" with a password in the page source.`,
        excerpts: [
          excerpt(
            "URL",
            `https://${m[1]}:***@${m[3]}`,
            lineAt(ctx.body, m.index ?? 0),
          ),
        ],
      };
    },
  },
];
