# Compatibility

## Runtime

| Component | Supported range | Notes |
| --- | --- | --- |
| Node.js | `^22.19.0` or `>=24.0.0` | Node.js 23 is outside the supported DSH engine range. |
| DeepSeek Harness | `0.1.0-rc.5` and compatible `0.1.x` releases | The plugin uses the commands, tools, and subprocess services. |
| Profile | `web` by default | Override `profile` when installing catalog entries into another profile. |

The automated test matrix runs on Node.js 22.19 and 24. The initial integration verification used the DSH Web profile and confirmed that the bundle was mounted and enabled.

## Package format

The repository ships JavaScript directly and declares `dsh.bundle.patch`. Installing from GitHub does not require a `prepare` build or pnpm `allowBuilds` approval.

## Operating systems

The plugin does not invoke a shell and uses Node.js filesystem and subprocess APIs. Automated CI runs on Linux; local integration verification has also been completed on macOS. Windows reports are welcome through the issue tracker.

Installation audits read pnpm lockfile formats through a YAML parser and tolerate unavailable evidence by labeling it explicitly. Exact resolution fields depend on what the active pnpm version records. Registry packages normally expose `resolution.integrity`; Git dependencies normally expose a commit and tarball URL instead.
