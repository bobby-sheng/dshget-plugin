# Security Policy

## Supported versions

Security fixes are applied to the latest release. Users should update the plugin before reporting an issue that is already fixed on `main`.

## Trust boundary

DSH plugins run in the DSH host process with the user's operating-system permissions. Installing any third-party catalog entry therefore executes code outside the model tool approval boundary.

DSH Get Plugin reduces this risk by:

- keeping model-facing tools read-only;
- requiring a human `/dshget install` command;
- accepting only npm package identifiers, `github:` specifications, or GitHub-hosted release tarballs;
- rejecting local paths, arbitrary URLs, and shell syntax;
- executing `dsh plugin add` with a fixed argument array rather than a shell;
- validating and size-limiting remote catalog snapshots before caching them.

Catalog inclusion is not a security review or endorsement. Users should inspect a plugin's source, permissions, maintenance history, and license before installation.

## Reporting a vulnerability

Use GitHub's private security advisory flow at `Security > Advisories > Report a vulnerability` in this repository. Include the affected version, a minimal reproduction, and the expected impact. Do not publish credentials, exploit details, or private repository data in a public issue.
