# thunderid

Run Thunder instantly via `npx` with zero manual setup.

## Quick Start

```bash
npx thunderid
```

On first run, the CLI:

1. Prompts for an install directory (defaults to `~/.thunderid/<version>`).
2. Downloads the platform-specific Thunder release zip from GitHub.
3. Extracts it and stores local state in `~/.thunderid/state.json`.
4. Runs `setup.sh` from the extracted Thunder directory.

On later runs with the same version, it reuses the cached installation.
Different Thunder versions are tracked independently in `~/.thunderid/state.json`.

## Pass Arguments Through

Any extra args are forwarded to Thunder's `setup.sh`:

```bash
npx thunderid -- --help
npx thunderid -- --some-flag value
```

## Requirements

- Node.js `>= 18`
- macOS or Linux: `unzip` available in `PATH`
- Windows: `tar` available in `PATH`, plus a Unix-like shell (WSL or Git Bash) to run `setup.sh`

## Package

- npm package: `thunderid`
- binary: `thunderid`
- source repo: <https://github.com/brionmario/thunder-npx>
- Thunder project: <https://github.com/asgardeo/thunder>

## Notes

- The downloaded asset name is resolved from OS and CPU architecture.
- Supported architectures are `x64` and `arm64`.
- If a platform/arch combo is unsupported, the CLI exits with an error.
