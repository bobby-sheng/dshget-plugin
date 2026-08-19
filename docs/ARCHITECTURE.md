# Architecture

DSH Get Plugin is a small Host plugin with two user-facing command paths and no browser bundle.

```text
Embedded catalog --------------------------+
                                            |
Validated remote snapshot -> local cache --+--> CatalogStore
                                                   |
                           +-----------------------+----------------------+
                           |                                              |
                  read-only agent tools                         /dshget commands
                  search and inspect                search, inspect, refresh, install
                                                                           |
                                                        fixed argv -> dsh plugin add
```

## Catalog selection

`CatalogStore` uses one snapshot at a time:

1. A valid local cache is preferred and marked stale according to its modification time.
2. If the cache is missing or invalid, the embedded release snapshot is loaded.
3. `/dshget update` fetches the configured URL, enforces byte limits, validates the complete catalog, writes a private temporary file, and atomically replaces the cache.

The website is not a runtime dependency. It provides canonical detail pages, while the plugin can continue searching its embedded data when the website or data repository is unavailable.

## Installation boundary

Agent tools cannot install software. The human command resolves one exact catalog record, parses its documented install command into an allowlisted package specification, resolves the DSH executable, and spawns it without a shell.

This protects against command-string injection, but it does not make third-party plugin code trusted. The installed plugin still runs with the user's host permissions.
