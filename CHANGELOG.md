# Changelog

All notable changes to DSH Get Plugin are documented here.

## [0.2.0] - 2026-08-19

### Added

- Generate a six-section evidence report after `/dshget install` covering exact package/Git identity, registry integrity, repository metadata, lifecycle scripts, pnpm build policy, bundle patch rows, effective config changes, and removal instructions.
- Store an atomic, mode-`0600` installation audit under `$DSH_HOME/cache/dshget/install-audits/` with a known-good pre-install restoration snapshot.
- Parse profile, lockfile, workspace, bundle, and config data structurally with bounded YAML aliases.

### Security

- Keep raw `dsh --dump-config` values out of persistent audit records; config changes store only paths, types, and SHA-256 value hashes.
- State the remaining lifecycle-script and Host-process permission boundaries in every complete report and incomplete-audit fallback.

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

[0.2.0]: https://github.com/bobby-sheng/dshget-plugin/releases/tag/v0.2.0
[0.1.1]: https://github.com/bobby-sheng/dshget-plugin/releases/tag/v0.1.1
[0.1.0]: https://github.com/bobby-sheng/dshget-plugin/releases/tag/v0.1.0
