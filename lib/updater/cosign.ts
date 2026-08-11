/**
 * cosign signature verification for a downloaded release tarball, mirroring
 * the `cosign verify-blob --bundle ...` command documented in SECURITY.md's
 * "Verifying a Release" section.
 *
 * cosign is OPTIONAL: self-hosted environments vary widely (bare Node,
 * Docker, Pterodactyl-style panels) and most will not have it installed.
 * `verifyCosignSignature` never assumes it exists -- it probes first via
 * `commandAvailable`, and reports `attempted: false` (not a hard failure)
 * when the binary is missing. If cosign IS present and verification fails,
 * that's a real integrity signal and IS treated as a hard failure by the
 * caller (lib/updater/apply.ts) -- only a *missing* tool is soft.
 */

import { commandAvailable, execFileAsync } from "@/lib/updater/exec";
import { APP_REPO } from "@/lib/config/constants";

export const COSIGN_CERTIFICATE_OIDC_ISSUER =
  "https://token.actions.githubusercontent.com";

export function cosignCertificateIdentityRegexp(): string {
  return `https://github.com/${APP_REPO}`;
}

export async function isCosignAvailable(): Promise<boolean> {
  return commandAvailable("cosign", ["version"]);
}

export interface CosignVerifyResult {
  /** false when cosign isn't installed -- verification was skipped, not failed. */
  attempted: boolean;
  ok: boolean;
  output?: string;
  error?: string;
}

export async function verifyCosignSignature(params: {
  bundlePath: string;
  tarballPath: string;
}): Promise<CosignVerifyResult> {
  const available = await isCosignAvailable();
  if (!available) {
    return {
      attempted: false,
      ok: false,
      error:
        "cosign binary not found on this host. Signature verification was skipped; the release was still checksum-verified.",
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "cosign",
      [
        "verify-blob",
        "--bundle",
        params.bundlePath,
        "--certificate-identity-regexp",
        cosignCertificateIdentityRegexp(),
        "--certificate-oidc-issuer",
        COSIGN_CERTIFICATE_OIDC_ISSUER,
        params.tarballPath,
      ],
      { timeout: 30_000 },
    );
    return {
      attempted: true,
      ok: true,
      output: `${stdout}\n${stderr}`.trim(),
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
