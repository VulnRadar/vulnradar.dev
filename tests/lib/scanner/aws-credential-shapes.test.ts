import { describe, it, expect } from "vitest";
import {
  findAwsAccessKeyIds,
  findAwsSecretKey,
  isPlausibleAwsSecretKey,
} from "@/lib/scanner/_helpers";
import { detectors as codeDetectors } from "@/lib/scanner/checks/code";
import { detectors as contentDetectors } from "@/lib/scanner/checks/content";
import { detectors as secretsDetectors } from "@/lib/scanner/checks/secrets-extended";

/**
 * A scan reported two criticals, a leaked AWS access key (evidence
 * `AKIAAJQA****AKQA`) and the secret key "near" it, on a site that leaks
 * neither. The AI pass marked both likely false positives. That evidence is
 * what the middle of a base64-encoded binary looks like: zero bytes encode as
 * runs of A and Q. These tests keep a blob like that from reaching any of the
 * four AWS detectors, and keep a real-shaped leak reaching all of them.
 */

// A woff2-style data URI whose payload contains AKIAAJQA…AKQA mid-run, the
// way the reported evidence did. Every AWS detector used to fire on this.
const FONT_BLOB =
  "d09GMgABAAAAAKIAAJQAAAAAAKQAAKQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGQAAAAAABQAAAAAQAAAAQAAAAAAAAAAAAAAAAAA";
const BLOB_PAGE = `<html><head><style>@font-face{font-family:i;src:url(data:font/woff2;base64,${FONT_BLOB}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA)}</style></head><body>hello</body></html>`;

// Key-shaped, not AWS's documented example. The ID uses only the base32
// alphabet real IDs use; the secret is 40 characters of mixed base64. Both
// are assembled from pieces so the source never holds a key-shaped literal,
// which push protection rightly refuses whether or not it is live.
const REAL_ID = ["AKIA", "2E3QXZ7N", "PLMVKD6R"].join("");
const REAL_SECRET = ["q8Vh3zR+tLk2", "WmPx9bYc/Fn4Ud7J", "g1Ea5Hs0NiTo"].join(
  "",
);
const LEAK_PAGE = `<script>const s3 = new S3Client({ credentials: { accessKeyId: "${REAL_ID}", secretAccessKey: "${REAL_SECRET}" } });</script>`;

const headers = new Headers({ "content-type": "text/html" });
const URL_ = "https://example.test/";

function fires(
  detector: ((url: string, h: Headers, b: string) => unknown) | undefined,
  body: string,
): boolean {
  if (!detector) throw new Error("detector missing");
  return detector(URL_, headers, body) != null;
}

describe("AWS credentials inside a base64 blob", () => {
  it("the blob really does contain the old pattern", () => {
    expect(/AKIA[0-9A-Z]{16}/.test(BLOB_PAGE)).toBe(true);
  });

  it("is not an access key ID", () => {
    expect(findAwsAccessKeyIds(BLOB_PAGE)).toEqual([]);
  });

  it("is not a secret key either", () => {
    expect(findAwsSecretKey(BLOB_PAGE)).toBeNull();
  });

  it("raises none of the four AWS detectors", () => {
    expect(fires(codeDetectors["hardcoded-secrets"], BLOB_PAGE)).toBe(false);
    expect(fires(contentDetectors["aws-credentials-exposed"], BLOB_PAGE)).toBe(
      false,
    );
    expect(fires(secretsDetectors["secret-aws-access-key-id"], BLOB_PAGE)).toBe(
      false,
    );
    expect(fires(secretsDetectors["secret-aws-secret-key"], BLOB_PAGE)).toBe(
      false,
    );
  });

  it("does not accept a bounded but low-entropy AKIA run", () => {
    expect(findAwsAccessKeyIds('"AKIAAAAAAAAAAAAAAAAA"')).toEqual([]);
  });
});

describe("a real-shaped leak still fires", () => {
  it("finds the access key ID and the secret key", () => {
    expect(findAwsAccessKeyIds(LEAK_PAGE)).toEqual([REAL_ID]);
    expect(findAwsSecretKey(LEAK_PAGE)).toBe(REAL_SECRET);
  });

  it("raises all four AWS detectors", () => {
    expect(fires(codeDetectors["hardcoded-secrets"], LEAK_PAGE)).toBe(true);
    expect(fires(secretsDetectors["secret-aws-access-key-id"], LEAK_PAGE)).toBe(
      true,
    );
    expect(fires(secretsDetectors["secret-aws-secret-key"], LEAK_PAGE)).toBe(
      true,
    );
    expect(
      fires(
        contentDetectors["aws-credentials-exposed"],
        `aws_access_key_id = ${REAL_ID}`,
      ),
    ).toBe(true);
  });

  it("finds a labeled secret in an env file with no key ID beside it", () => {
    expect(findAwsSecretKey(`AWS_SECRET_ACCESS_KEY=${REAL_SECRET}\n`)).toBe(
      REAL_SECRET,
    );
  });

  it("finds a secret passed positionally after the key ID", () => {
    expect(
      findAwsSecretKey(
        `new AWS.Credentials("${REAL_ID}", "${REAL_SECRET}", null);`,
      ),
    ).toBe(REAL_SECRET);
  });
});

describe("what a secret key is not", () => {
  it("a SHA-1 has no upper case", () => {
    expect(
      isPlausibleAwsSecretKey("da39a3ee5e6b4b0d3255bfef95601890afd80709"),
    ).toBe(false);
  });

  it("a path has neither the mix nor the entropy", () => {
    expect(
      isPlausibleAwsSecretKey("assets/Images/Background/header/logo2024"),
    ).toBe(false);
  });

  it("AWS's own documentation secret is an example", () => {
    expect(
      isPlausibleAwsSecretKey("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
    ).toBe(false);
  });

  it("a forty-character hash beside a real ID is not paired with it", () => {
    expect(
      findAwsSecretKey(
        `"${REAL_ID}" etag:"da39a3ee5e6b4b0d3255bfef95601890afd80709"`,
      ),
    ).toBeNull();
  });
});
