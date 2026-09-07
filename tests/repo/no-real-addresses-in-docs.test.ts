import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * No real server address is written into the documentation.
 *
 * This exists because one was. SECURITY-POSTURE.md carried the production
 * origin's actual IP and port in a worked nginx example for several releases,
 * which is still in git history and in the release tarballs cut from it. The
 * value itself is not a credential and the port was reachable anyway, so the
 * damage was modest; the mechanism is the finding. Nobody put it there on
 * purpose. It arrived the way these always do, by pasting a config that
 * worked on the real box into a document explaining how to configure it.
 *
 * Scoped to prose (Markdown), not to the whole tree, on purpose. An IPv4-shaped
 * regex over source is unusably noisy: SVG path data in a single icon component
 * produced a dozen "addresses" like 5.69.41.36, and the scanner legitimately
 * hardcodes cloud metadata endpoints and public resolvers because those are
 * what it probes for. Documentation is where a real address actually gets
 * pasted, and where a reader is most likely to copy it back out.
 *
 * lib/ai/*.md are excluded: they are generated from the other sources by
 * `npm run build:knowledge`, so a finding there is a duplicate of one here.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Tracked Markdown, minus the generated knowledge files. */
function docFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "*.md", ":!lib/ai/*.md"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

const IPV4 =
  /\b((?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/g;

/**
 * Addresses a document may legitimately contain.
 *
 * Everything here is either unroutable, reserved by an RFC for exactly this
 * purpose, or a public service so well known that naming it reveals nothing
 * about our infrastructure.
 */
function isAllowed(ip: string): boolean {
  const p = ip.split(".").map(Number);

  // Unroutable and reserved: loopback, RFC 1918 private, link-local,
  // "this host", broadcast, and multicast.
  if (p[0] === 127 || p[0] === 0 || p[0] === 10) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] >= 224) return true;

  // RFC 5737: reserved for documentation, which is what this file is about.
  // The third block is 203.0.113.0/24, so the match is on the first THREE
  // octets. Checking p[1] === 113 here was wrong and rejected the very range
  // this test tells people to use.
  if (p[0] === 192 && p[1] === 0 && p[2] === 2) return true;
  if (p[0] === 198 && p[1] === 51 && p[2] === 100) return true;
  if (p[0] === 203 && p[1] === 0 && p[2] === 113) return true;

  // RFC 6890 benchmarking and RFC 6598 carrier-grade NAT, both of which the
  // scanner's SSRF documentation has cause to name.
  if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;

  // Public resolvers, named in shell examples (`ip route get 1.1.1.1`) and in
  // DNS documentation. These are everybody's, not ours.
  return ["1.1.1.1", "8.8.8.8", "8.8.4.4", "9.9.9.9", "1.0.0.1"].includes(ip);
}

describe("documentation contains no real server addresses", () => {
  it("every IPv4 in the docs is reserved, private, or a public resolver", () => {
    const offenders: string[] = [];

    for (const rel of docFiles()) {
      const lines = fs
        .readFileSync(path.join(ROOT, rel), "utf8")
        .split(/\r?\n/);
      for (const [i, line] of lines.entries()) {
        for (const ip of line.match(IPV4) ?? []) {
          if (!isAllowed(ip)) offenders.push(`${rel}:${i + 1}  ${ip}`);
        }
      }
    }

    expect(
      offenders,
      "A routable IP address is written into the documentation. If this is a " +
        "real host, replace it with an RFC 5737 documentation address " +
        "(203.0.113.x) or 127.0.0.1. Committing it publishes your " +
        "infrastructure and it cannot be taken back out of git history:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("no document embeds a connection string with a password", () => {
    // The other half of the same mistake: pasting a working DATABASE_URL into
    // a setup guide. .env.example uses placeholders and is the right place for
    // the shape of one.
    const withCreds =
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@/i;
    const offenders: string[] = [];

    for (const rel of docFiles()) {
      const lines = fs
        .readFileSync(path.join(ROOT, rel), "utf8")
        .split(/\r?\n/);
      for (const [i, line] of lines.entries()) {
        const m = line.match(withCreds);
        if (!m) continue;
        // A placeholder is fine and is what these guides should show.
        if (
          /\b(user|username|USER|password|PASSWORD|pass|changeme|yourpassword|<[^>]+>|\$\{)/.test(
            m[0],
          )
        ) {
          continue;
        }
        // A loopback or private host cannot be a production leak. This is the
        // shape of the throwaway container in tests/README.md: a local test
        // database on 127.0.0.1 with a two-character password, which is a
        // correct thing for a contributor guide to show.
        const host = line.slice(line.indexOf(m[0]) + m[0].length);
        if (
          /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|localhost\b|\[::1\])/.test(
            host,
          )
        ) {
          continue;
        }
        offenders.push(`${rel}:${i + 1}`);
      }
    }

    expect(
      offenders,
      "A connection string with what looks like a real password is in the " +
        "docs:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });
});
