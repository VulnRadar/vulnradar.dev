# vulnradar (CLI)

Run a [VulnRadar](https://vulnradar.dev) scan from your shell or any CI and fail
the build when findings cross a severity threshold. Same flow as the GitHub
Action and the GitLab CI template, no dependencies (Node 22+, matching the
rest of the project; Node 18 reached end of life in April 2025 and is not
tested anywhere).

## Install

```
npx vulnradar scan https://your-staging-url.com --max-high 0
```

`npx` needs no install at all, which is usually what you want in CI. For a
permanent command on your PATH:

```
npm i -g vulnradar
vulnradar scan https://your-staging-url.com --max-high 0
```

Pass your token with `--api-key` or the `VULNRADAR_TOKEN` environment
variable. Prefer the variable in CI so the key never lands in shell history or
a log. Create one under Settings > API Keys.

### From source

Only needed to work on the CLI itself, or to run an unreleased change:

```
git clone https://github.com/VulnRadar/vulnradar.dev.git
cd vulnradar.dev/cli
npm install -g .          # or: npm link, for a live-linked dev copy
```

Or run the entrypoint directly, with no install:

```
VULNRADAR_TOKEN=your-token node vulnradar.mjs scan https://your-staging-url.com
```

## Options

```
vulnradar scan <url> [options]

  --api-key <key>        API token (or set VULNRADAR_TOKEN). Settings > API Keys.
  --api-base <url>       API base URL. Override for a self-hosted deployment,
                         or set VULNRADAR_API_BASE (the flag wins).
                         Default: https://vulnradar.dev/api/v3
  --crawl                Crawl and scan the pages your plan allows instead of
                         one URL (25/50/100/250 by tier; a self-hosted
                         deployment with billing off is uncapped).
  --max-critical <n>     Fail if criticals exceed this. Default: 0
  --max-high <n>         Fail if highs exceed this. Default: 0
  --max-medium <n>       Fail if mediums exceed this; -1 disables. Default: -1
  --timeout <seconds>    Give up waiting for the scan. Default: 300, or 900
                         with --crawl, which matches the larger budget the
                         server gives a crawl.
  --poll-interval <s>    Seconds between status polls. Default: 5
  --scanners <list>      Comma-separated categories to run, e.g.
                         headers,ssl,content. Default: the server's standard set.
  --public | --private   List the scan in the public directory, or keep it out.
                         Omitted, your account's default applies.
  --team-id <id>         Share the scan with a team you manage. Repeat for several.
  --report <format>      Download a report once the scan finishes: json, sarif,
                         md, markdown, compliance, csv, pdf. Printed to stdout
                         unless --out is given.
  --out <path>           Write the --report file here. Required for pdf, which
                         is binary, and with --json, which owns stdout.
  --apply-triage         In the report, mark accepted-risk and won't-fix
                         findings as suppressed. GitHub reads SARIF
                         suppressions as "dismissed". Default: off.
  --include-suppressed   In the report, keep findings you marked a false
                         positive. Default: off, matching the dashboard.
  --json                 Print the raw completed result as JSON.
  -v, --version          Print the CLI version.
  -h, --help             Show help.

Starting a scan that the API rate-limits (HTTP 429) is retried after the
`Retry-After` it sends, up to three times and never past `--timeout`. Every
request carries `User-Agent: vulnradar-cli/<version>`.
```

### Reports

`--report` pulls the same files the web app exports, straight from the API, so
a pipeline can keep the artifact it needs without a second request and a second
copy of the token:

```
vulnradar scan https://staging.example.com --report sarif --out results.sarif
```

The download happens before the thresholds are judged, so a run that exits `1`
still leaves the file for the step that uploads it:

```yaml
- name: VulnRadar scan
  env:
    VULNRADAR_TOKEN: ${{ secrets.VULNRADAR_TOKEN }}
  run: vulnradar scan https://staging.example.com --report sarif --out results.sarif
- name: Upload to code scanning
  if: always()
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

`compliance` is the PCI/SOC 2/ISO 27001/ASVS crosswalk in Markdown, `pdf`
needs `--out` because it is binary, and `json` here is the report document
(triage applied), which is not the same thing as `--json`, the raw scan result.

### Exit codes

| Code | Meaning                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Every finding count is at or under its threshold.                                                                         |
| `1`  | The scan ran and a threshold was exceeded. This is a real result.                                                         |
| `2`  | The scan could not run: bad arguments, no/invalid API key, network failure, an API error, or a scan that never completed. |

`1` and `2` used to both be `1`, which meant a pipeline could not tell "we
found a critical, block the merge" from "VulnRadar was briefly unreachable".
A script testing for any non-zero exit is unaffected; one that wants the gate
result specifically can now ask for it.

## Example: GitHub Actions

```yaml
- run: npx vulnradar scan https://staging.example.com --max-critical 0 --max-high 0
  env:
    VULNRADAR_TOKEN: ${{ secrets.VULNRADAR_TOKEN }}
```

There is also a prebuilt action in `.github/actions/scan-gate` if you would
rather pin an action than a package version.

## Develop

```
npm test           # unit tests plus the spawned-CLI tests, with coverage
```
