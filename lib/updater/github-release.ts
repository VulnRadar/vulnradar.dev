/**
 * GitHub release lookup + asset download for the self-update flow.
 * Network boundary only -- no verification logic lives here (see
 * lib/updater/checksum.ts and lib/updater/cosign.ts). Kept separate so
 * app/api/version/route.ts and the admin updater routes can share the
 * same "ask GitHub about a release" code instead of each doing its own
 * fetch + JSON shape assumptions.
 */

import { APP_REPO } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GithubRelease {
  tagName: string;
  /** tag with a leading "v" stripped, e.g. "3.1.0" */
  version: string;
  htmlUrl: string;
  body: string | null;
  assets: GithubReleaseAsset[];
}

const GITHUB_API_BASE = `https://api.github.com/repos/${APP_REPO}`;

interface RawGithubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string | null;
  assets?: { name: string; browser_download_url: string; size: number }[];
}

function toRelease(raw: RawGithubRelease): GithubRelease {
  const tagName = raw.tag_name || "";
  return {
    tagName,
    version: tagName.replace(/^v/, ""),
    htmlUrl:
      raw.html_url || `https://github.com/${APP_REPO}/releases/tag/${tagName}`,
    body: raw.body ?? null,
    assets: (raw.assets || []).map((a) => ({
      name: a.name,
      browser_download_url: a.browser_download_url,
      size: a.size,
    })),
  };
}

async function githubJson(url: string): Promise<RawGithubRelease | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/vnd.github+json" },
    // Never serve a stale cached release when the admin explicitly asked
    // to check for or apply an update.
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as RawGithubRelease;
}

/** GET /releases/latest */
export async function fetchLatestRelease(): Promise<GithubRelease | null> {
  const raw = await githubJson(`${GITHUB_API_BASE}/releases/latest`);
  return raw ? toRelease(raw) : null;
}

/** GET /releases/tags/{tag}. `tag` must already include the leading "v". */
export async function fetchReleaseByTag(
  tag: string,
): Promise<GithubRelease | null> {
  const raw = await githubJson(
    `${GITHUB_API_BASE}/releases/tags/${encodeURIComponent(tag)}`,
  );
  return raw ? toRelease(raw) : null;
}

/** Resolves "latest" or a bare/prefixed version string to a release. */
export async function resolveRelease(
  target: string,
): Promise<GithubRelease | null> {
  if (!target || target === "latest") return fetchLatestRelease();
  const tag = target.startsWith("v") ? target : `v${target}`;
  return fetchReleaseByTag(tag);
}

export class AssetDownloadError extends Error {}

/**
 * Streams a release asset into memory with a hard byte cap. Verified
 * releases are small (source tarball, checksums file, cosign bundle), so
 * `maxBytes` should be set generously above the expected size, not left
 * unbounded -- a compromised or malicious download host should not be
 * able to exhaust server memory via an oversized asset.
 */
export async function downloadReleaseAsset(
  asset: GithubReleaseAsset,
  maxBytes: number,
): Promise<Buffer> {
  const downloadTimeoutMs = await getSetting(
    "UPDATER_ASSET_DOWNLOAD_TIMEOUT_MS",
  );
  const res = await fetch(asset.browser_download_url, {
    signal: AbortSignal.timeout(downloadTimeoutMs),
    cache: "no-store",
  });
  if (!res.ok || !res.body) {
    throw new AssetDownloadError(
      `Failed to download ${asset.name}: HTTP ${res.status}`,
    );
  }

  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new AssetDownloadError(
      `${asset.name} is larger than the ${maxBytes} byte limit (Content-Length: ${contentLength}).`,
    );
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new AssetDownloadError(
        `${asset.name} exceeded the ${maxBytes} byte limit while downloading.`,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/** Case-sensitive lookup by exact asset filename. */
export function findAsset(
  release: GithubRelease,
  name: string,
): GithubReleaseAsset | null {
  return release.assets.find((a) => a.name === name) || null;
}
