# Changelog

All notable changes to DSH Get Plugin are documented here.

## [0.1.1] - 2026-08-19

### Fixed

- Target the DSH profile workspace root explicitly when installing this plugin or a catalog plugin, avoiding `ERR_PNPM_ADDING_TO_ROOT` on pnpm configurations that enforce the workspace-root check.

## [0.1.0] - 2026-08-19

### Added

- `/dshget search`, `info`, `install`, `update`, and `status` commands.
- Read-only `dshget_search` and `dshget_plugin_info` agent tools.
- Embedded catalog snapshot for offline search and inspection.
- Validated, size-limited remote catalog refresh with atomic cache replacement.
- Exact DSH Get detail links for plugin names containing special characters.
- Fixed-argument installation without shell evaluation.

### Security

- Installation is available only through an explicit human slash command.
- Local paths, arbitrary download hosts, shell operators, and unsupported package specifications are rejected.

[0.1.1]: https://github.com/bobby-sheng/dshget-plugin/releases/tag/v0.1.1
[0.1.0]: https://github.com/bobby-sheng/dshget-plugin/releases/tag/v0.1.0
