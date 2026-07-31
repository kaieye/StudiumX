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

When GitHub Releases reports a newer version, `electron-updater` downloads it
in the background. After the download has completed, the app prompts the user
to restart immediately or to install automatically during the next normal app
quit. The updater is intentionally inactive for `pnpm dev` and unpackaged
local builds.

## GitHub release flow

1. Update the `version` in `package.json` to the release version.
2. Merge the change into `main` and create a matching annotated tag, for
   example `v0.1.1` for version `0.1.1`.
3. Push the tag. The `Release desktop installers` workflow builds the native
   installers on macOS (Apple Silicon), Windows x64, and Linux x64.
4. After every platform build succeeds, the workflow publishes one GitHub
   Release containing both installers and updater manifests.

The workflow deliberately publishes only after the matrix completes. This
prevents a running app from finding a partially uploaded release.

## macOS signing

The installer built locally is unsigned. Before distributing macOS releases to
other users, configure the repository secrets `CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` with the Apple
Developer signing and notarization credentials. The release workflow forwards
them to `electron-builder`; without them, macOS may warn when opening the app
and in-place installation after an update cannot be relied upon. Configure
these credentials before publishing a public macOS release: a signed and
notarized app is required for a dependable in-place macOS update experience.
