# DSH Get Plugin

[![CI](https://github.com/bobby-sheng/dshget-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/bobby-sheng/dshget-plugin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Search, inspect, update, and install DeepSeek Harness plugins without leaving DSH. The plugin uses the public [DSH Get](https://www.dshget.com/) catalog, ships an embedded snapshot for offline search, and links every result to its independent detail page.

This is an independently maintained community plugin. It is not affiliated with or endorsed by DeepSeek.

## Install

```bash
dsh plugin --profile web add github:bobby-sheng/dshget-plugin
```

Restart DSH after installation. The package ships JavaScript directly, so a GitHub installation does not run a build or `prepare` script.

Supported runtime: DeepSeek Harness `0.1.0-rc.5` and newer compatible `0.1.x` prereleases, on Node.js `22.19+` or `24+`. See [compatibility](docs/COMPATIBILITY.md) for details.

## Commands

```text
/dshget search memory recall
/dshget info volcengine/OpenViking#examples/dsh-memory-plugin
/dshget install example/dsh-plugin
/dshget update
/dshget status
```

- `search` searches names, owners, categories, tags, descriptions, and catalog sources.
- `info` accepts `owner/name`, a unique plugin name, a DSH Get URL, or a GitHub URL.
- `install` installs the exact catalog entry into the configured DSH profile and asks you to restart DSH.
- `update` fetches and validates the latest public snapshot from `dshget-data`.
- `status` reports the active snapshot and whether the cache has passed its configured TTL.

## Agent tools

- `dshget_search` searches the catalog and returns structured results.
- `dshget_plugin_info` returns one structured plugin record.

Both tools are read-only. Installation is intentionally available only through the human `/dshget install` command.

## Why use it

- Search the catalog from the same DSH session where you work.
- Keep a validated embedded snapshot available when the network or website is unavailable.
- Inspect the exact repository and install command before installing anything.
- Require an explicit human slash command for third-party installation.

## Independent operation

The website and plugin do not call each other at runtime:

- DSH Get continues to build and serve its own catalog and detail pages.
- This plugin searches its embedded `data/catalog.json` when no cache is available.
- `/dshget update` writes a validated snapshot under `$DSH_HOME/cache/dshget/`.
- A website or data-host outage does not remove offline search and plugin details from the installed package.

## Configuration

Override the bundle row in your profile `cordis.patch.yml`:

```yaml
- id: dshget-plugin
  config:
    profile: web
    maxResults: 10
    cacheTtlHours: 24
    allowInstall: true
```

Available settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| `dataUrl` | public `dshget-data/catalog.json` | Remote snapshot used by `update` |
| `websiteUrl` | `https://www.dshget.com` | Canonical plugin detail links |
| `profile` | `web` | Profile changed by `install` |
| `dshCommand` | `dsh` | DSH executable name or absolute path |
| `cachePath` | `$DSH_HOME/cache/dshget/catalog.json` | Validated local snapshot |
| `cacheTtlHours` | `24` | Age used by `status` |
| `requestTimeoutMs` | `15000` | Remote update timeout |
| `maxCatalogBytes` | `20000000` | Maximum accepted remote snapshot size |
| `maxResults` | `10` | Default command and tool result limit |
| `allowInstall` | `true` | Enables the human install command |

## Installation safety

Installing any third-party DSH plugin runs code from that package. Review its source, permissions, license, and maintenance status first. Catalog inclusion is not a security review.

DSH Get Plugin does not execute catalog commands through a shell. It accepts only the documented `dsh plugin ... add` format, extracts an allowlisted npm package, `github:` spec, or GitHub Release tarball, and starts DSH with an argument array. Shell operators, local paths, arbitrary URLs, and unsupported install formats are rejected.

See [SECURITY.md](SECURITY.md) for the trust boundary and vulnerability reporting process.

## 中文说明

DSH Get Plugin 可以直接在 DSH 中搜索、查看和安装 DeepSeek Harness 插件。插件内置目录快照，因此网站或数据仓库暂时不可用时仍可离线搜索；执行 `/dshget update` 后会使用最新的公开数据缓存。

智能体工具只读，不会自动安装第三方代码。安装必须由用户明确执行 `/dshget install <owner/name>`，并且只允许目录中的安全 npm 或 GitHub 包标识。安装完成后需要重启 DSH。

插件详情和可视化浏览继续由 [DSH Get](https://www.dshget.com/) 独立提供，网站不依赖本插件运行。

## Development

```bash
npm install
npm test
npm run check
```

The test suite covers relevance ordering, special-character routes, cache fallback, remote validation, byte limits, and install-command injection rejection.

Project documentation:

- [Architecture](docs/ARCHITECTURE.md)
- [Compatibility](docs/COMPATIBILITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## License

MIT
