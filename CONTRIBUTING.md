# Contributing

Contributions should keep the plugin small, inspectable, and safe to install in a DSH host process.

## Requirements

- Node.js `22.19+` or `24+`
- npm
- A supported DeepSeek Harness profile for integration testing

## Setup

```bash
npm ci
npm run check
```

The check runs unit tests, validates every installable entry in the embedded catalog, and verifies the npm package contents.

## Development rules

- Add focused tests for behavior changes.
- Keep `dshget_search` and `dshget_plugin_info` read-only.
- Keep third-party installation behind the explicit `/dshget install` command.
- Never pass catalog strings through a shell. Spawn `dsh` with a fixed argument array.
- Validate remote data before replacing the local cache.
- Do not add credentials, private repository metadata, or user telemetry.

## Pull requests

Explain the user-visible change, the trust-boundary impact, and the commands used to verify it. Small, single-purpose pull requests are easier to review.

The embedded snapshot is sourced from the public `dshget-data` catalog. Changes to the catalog pipeline belong in that project; this repository contains only the release snapshot consumed offline.
