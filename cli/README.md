# vulnradar (CLI)

Run a [VulnRadar](https://vulnradar.dev) scan from your shell or any CI and fail
the build when findings cross a severity threshold. Same flow as the GitHub
Action and the GitLab CI template, no dependencies (Node 22+, matching the
rest of the project; Node 18 reached end of life in April 2025 and is not
tested anywhere).

> **Not on npm yet.** This tool ships from the repo for now. `npm i -g vulnradar`
> and `npx vulnradar` will work once it is published; until then, install from
> source as shown below.

## Install from the repo

```
git clone https://github.com/VulnRadar/vulnradar.dev.git
cd vulnradar.dev/cli
npm install -g .          # or: npm link, for a live-linked dev copy
vulnradar scan https://your-staging-url.com --max-high 0
```

Or run it directly without a global install:

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
  --json                 Print the raw completed result as JSON.
  -h, --help             Show help.
```

Exit code is `0` when findings are under the thresholds, `1` otherwise (or on
error), so it drops straight into a CI gate.

## Example: GitHub Actions

Until the CLI is on npm, install it from the repo in the job (or use the
prebuilt GitHub Action in `.github/actions/`):

```yaml
- run: |
    git clone --depth 1 https://github.com/VulnRadar/vulnradar.dev.git /tmp/vr
    node /tmp/vr/cli/vulnradar.mjs scan https://staging.example.com --max-critical 0 --max-high 0
  env:
    VULNRADAR_TOKEN: ${{ secrets.VULNRADAR_TOKEN }}
```

Once published, this simplifies to `npx vulnradar scan …`.

## Develop

```
npm test           # unit tests plus the spawned-CLI tests, with coverage
```
