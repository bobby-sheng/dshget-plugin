# Troubleshooting

## `/dshget` does not appear

Restart the DSH process after installation, then open `Settings > Plugins > Plugin list` and search for `dshget-plugin`. The status should be mounted and enabled.

Run the configuration dump if the row is missing:

```bash
dsh --profile web --dump-config
```

The output should contain an enabled row named `dshget-plugin`.

## DSH prints a Node.js engine warning

Use Node.js 22.19 or 24+. Node.js 23 is outside the supported engine range used by DeepSeek Harness.

## Catalog update fails

`/dshget update` requires access to the public `dshget-data` snapshot. A failed update does not delete the embedded catalog or a previously validated cache. Run `/dshget status` to see which source is active.

## Search returns an old result

Run `/dshget update`, then repeat the search. If the update cannot reach GitHub, the plugin continues using its cache or embedded release snapshot.

## Installation is rejected

The catalog entry must be marked installable and use one of the supported forms:

- npm package identifier;
- `github:owner/repository` specification;
- `.tgz` or `.tar.gz` file hosted by GitHub Releases.

Local paths, arbitrary URLs, shell operators, and unsupported command formats are intentionally rejected.

## Installation succeeds but the new plugin is missing

Restart DSH after `/dshget install`. The command modifies the selected profile package set; a running DSH process does not load the new dependency automatically.
