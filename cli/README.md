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
a log. Create one under Profile > Developer > API Keys.

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

  --api-key <key>        API token (or set VULNRADAR_TOKEN). Create one under
                         Profile > Developer > API Keys.
  --api-base <url>       API base URL. Override for a self-hosted deployment,
                         or set VULNRADAR_API_BASE (the flag wins).
                         Default: https://vulnradar.dev/api/v3
  --allow-insecure       Allow a plain http:// --api-base to a host that is not
                         this machine. The key is sent unencrypted, so without
                         this flag the CLI refuses. localhost is always fine.
  --crawl                Crawl and scan the pages your plan allows instead of
                         one URL (the cap depends on your plan, see
                         https://vulnradar.dev/docs/cli; a self-hosted
                         deployment with billing off is uncapped).
  --max-critical <n>     Fail if criticals exceed this, 0 or more. Default: 0
  --max-high <n>         Fail if highs exceed this, 0 or more. Default: 0
  --max-medium <n>       Fail if mediums exceed this; -1 disables. Default: -1
  --include-suppressed   Count findings you marked a false positive, in the
                         thresholds and in a --report. Default: off, matching
                         the dashboard. Without it the CLI prints how many it
                         left out.
  --allow-incomplete     Do not exit 3 when the scan was blocked by a bot
                         challenge or could not fetch the page. What was not
                         checked is still printed.
  --fail-on-incomplete   Exit 3 when any area was not checked, not only those
                         two.
  --timeout <seconds>    Give up waiting for the scan. Default: 300, or 900
                         with --crawl, which matches the larger budget the
                         server gives a crawl.
  --cancel-on-timeout    Cancel the scan on the server when the timeout runs
                         out. Default: leave it running.
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
  --json                 Print the raw completed result as JSON. A failure
                         prints a failure document instead (see below).
  -v, --version          Print the CLI version.
  -h, --help             Show help.
```

Every request carries `User-Agent: vulnradar-cli/<version>`.

### Rate limits

A 429 when starting a scan is one of three things:

- **Another scan is already running** on the account (`statusCode` of
  `CONCURRENT_SCAN_LIMIT`). The CLI waits for the slot: the server's
  `Retry-After` if it sends one, otherwise 5, 10, then 20 seconds, for at most
  120 seconds in total. That wait is not taken out of `--timeout`.
- **Your daily scan quota is spent.** The wait is hours, so the CLI does not
  retry it. It says so and exits `2`.
- **Any other rate limit** is retried after its `Retry-After`, up to three
  times, if that fits in what is left of `--timeout`.

### Stopping a run

If the run is interrupted with `SIGINT` (Ctrl-C) or `SIGTERM` (a CI runner
cancelling the job), the CLI asks the server to cancel the scan it started,
waiting at most three seconds, and exits `130` or `143`. Otherwise the scan
would keep running and hold your only scan slot, and the re-run would be
refused until it finished. A scan that has not been created yet cannot be
cancelled. Once the `Started scan <id>` line is printed, a signal cancels that
scan, so a wrapper can wait for the line and then stop the run.

When `--timeout` runs out the scan is left running by default, because it will
finish and appear in your history. `--cancel-on-timeout` cancels it instead.

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

`compliance` is the compliance crosswalk in Markdown (PCI DSS, SOC 2, ISO
27001, OWASP ASVS, HIPAA and GDPR), `pdf` needs `--out` because it is binary,
and `json` here is the report document (triage applied), which is not the same
thing as `--json`, the raw scan result.

With no `--out` the report is the only thing on stdout: the progress lines go
to stderr, so `vulnradar scan $URL --report sarif > results.sarif` is a valid
file. `--out` creates the folder it points into before the scan starts. The
report is written to the path you give and nowhere else: a file name suggested
by the server's reply is ignored.

### What the gate counts

The thresholds judge the scan's findings, leaving out the ones you marked a
false positive: the dashboard and every report hide them, so a run that failed
on one would fail with nothing visible to fix. The CLI prints how many it left
out (`N suppressed by false-positive verdicts`). `--include-suppressed` counts
them. Accepted-risk and won't-fix findings are always counted; `--apply-triage`
only changes how they appear in a report.

A completed scan whose result has no `summary` object is an error (exit `2`),
not zero findings.

### Scans that did not check the target

A scan can finish without ever reading the site: it showed the scanner a bot
challenge, or the page could not be fetched (a bad certificate, an unreachable
host, a redirect to another host). It then has no findings, and a gate that
passed it would pass a site nobody looked at. So the CLI always prints what was
not checked, to stderr:

```
Not checked: The page itself: the scanner could not fetch it, so only the checks that never read a page ran
Page unreachable: <the reason>
```

and exits `3` when it was a bot challenge or an unreachable page. A failed
threshold (`1`) wins over `3`. `--allow-incomplete` accepts the partial scan
and keeps the printed notice. `--fail-on-incomplete` also exits `3` when any
other area was skipped (DNS, TLS, a crawl that ran out of time).

### Exit codes

| Code  | Meaning                                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `0`   | Every finding count is at or under its threshold.                                                                                        |
| `1`   | The scan ran and a threshold was exceeded. This is a real result, and it wins over `3`.                                                  |
| `2`   | The scan could not run: bad arguments, no/invalid API key, network failure, an API error, a failed scan, or a scan that never completed. |
| `3`   | The scan ran but did not check the target: a bot challenge, or the page could not be fetched. See above for the flags.                   |
| `130` | Interrupted by `SIGINT`. A scan that was already started is cancelled.                                                                   |
| `143` | Interrupted by `SIGTERM`. A scan that was already started is cancelled.                                                                  |

A pipeline that tests for any non-zero exit is unaffected by how many codes
there are. One that retries on "VulnRadar was briefly unreachable" should retry
on `2` only: `1` is a finding and `3` is a site that blocks the scanner, and
neither gets better by running again.

A report that cannot be fetched or written fails the run with `2`, but never
hides a failed gate: that still exits `1`. An incomplete scan (`3`) outranks a
failed report.

### `--json`

`--json` makes stdout one JSON document and nothing else; progress goes to
stderr. A scan that completes prints the raw result, which has no `ok` key: the
exit code is the success signal, not a field. Any failure that stops the run
prints this instead, and exits `2` (`130` or `143` when interrupted):

```json
{
  "ok": false,
  "error": "Scan failed: Could not reach the target. [target_unreachable]",
  "scanId": 4821,
  "failureKind": "target_unreachable"
}
```

Only `ok` and `error` are always there. `scanId` is present once a scan has
started. `failureKind` says why a scan that started then failed, and the
message ends with it in brackets. When a request is refused instead, `status`
is its HTTP status and `statusCode` the API's own code from the body (for
example `CONCURRENT_SCAN_LIMIT`). `failureKind` and `statusCode` are present
only when the API sends them.

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
