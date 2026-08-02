# Desktop installer release

StudiumX uses `electron-builder` to create installable desktop artifacts and
`electron-updater` to check the GitHub Release feed for packaged applications.

## Local package build

Build only for the current operating system and architecture; this is required
because `better-sqlite3` is a native Electron module:

```bash
pnpm run dist
```

Artifacts are written to `release/`. On macOS this produces a `.dmg` installer
and a `.zip` update payload. The zip and generated `latest-mac.yml` must be
published together for in-app updates to work. Windows and Linux likewise require
the corresponding `latest*.yml`, installer/AppImage, and `.blockmap` files.

## Automatic update behavior

Only a packaged application checks for updates. It checks once after the
application runtime starts, then retries every six hours while the application
remains open. Checks and downloads never delay startup.

When GitHub Releases reports a newer version, the app shows an in-app update
dialog that asks the user to start the download. During the download the dialog
shows live progress (percentage, bytes, and speed); failures are surfaced in
the dialog with a retry action instead of being swallowed. After the download
completes, the dialog prompts the user to restart immediately or to install
automatically during the next normal app quit (if the main window is hidden to
the tray, a system notification reminds the user). The updater is
intentionally inactive for `pnpm dev` and unpackaged local builds.

## GitHub release flow

1. Update the `version` in `package.json` to the release version.
2. Add curated release notes at `docs/releases/v<version>.md`.
3. Merge the change into `main` and create a matching annotated tag, for
   example `v0.1.1` for version `0.1.1`.
4. Push the tag. The `Release desktop installers` workflow builds native
   installers on Windows x64, Linux x64, and macOS Apple Silicon (arm64).
5. After every platform build succeeds, the workflow publishes one GitHub
   Release with the installers, updater manifests, and the curated release
   notes.

The workflow deliberately publishes only after the matrix completes. This
prevents a running app from finding a partially uploaded release.

## macOS distribution

The macOS arm64 build is published without signing or notarization credentials.
It can therefore trigger Gatekeeper warnings, and reliable in-app updates are
not a release guarantee. To support a dependable macOS installation and update
experience later, configure `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` as repository secrets.
