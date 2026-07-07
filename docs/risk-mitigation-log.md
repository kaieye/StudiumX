# Risk Mitigation Log

This log records codebase risk reviews and the concrete treatment applied after each review batch.

## 2026-07-07: External Link and web_fetch Hardening

Review lanes:

- Main-process external link capability.
- Agent web_fetch SSRF guard.
- Affected behavior checks and build tooling.

Findings:

- `BrowserWindow.webContents.setWindowOpenHandler` opened arbitrary renderer-created URLs directly through `shell.openExternal`, bypassing the `privacy.allowExternalLinks` setting used by the explicit `teach:open-external` IPC capability.
- The `web_fetch` tool rejected non-http(s), localhost names, and common private IPv4 ranges, but it did not cover IPv6 loopback, IPv6 unique-local/link-local/multicast addresses, IPv4-mapped IPv6, special IPv4 notations normalized by `URL`, or hostnames resolving to blocked addresses.
- The provider action check asserted implementation text for external links rather than the shared capability interface.

Treatment:

- Added `src/main/external-links.ts` as the shared external-link Module. Its interface validates http(s) URLs, honors `privacy.allowExternalLinks`, invokes the provided opener Adapter, and returns structured `{ ok, message }` results.
- Routed both `teach:open-external` and renderer-created window opens through the shared external-link Module. Window opens are still denied inside Electron and only opened externally after the shared checks pass.
- Deepened `web_fetch` URL validation with `assertSafePublicHttpUrl`, including IPv6 private/local ranges, IPv4-mapped IPv6, special IPv4 forms normalized by `URL`, `.local`/`.localhost` hostnames, and DNS resolution checks for hostnames before fetch.
- Added behavior fixtures and npm scripts for external link controls and web_fetch safe URL checks.
- Updated the existing provider action check to assert that the shared external-link Module is wired into IPC and window-open handling.

Verification:

- `npm run check:external-link-controls`
- `npm run check:web-fetch-safe-url`
- `npm run check:provider-actions`
- `node scripts/check-wechat-web-tools.mjs`
- `npm run build`

Residual risk:

- DNS preflight reduces hostname-to-private SSRF risk, but it does not fully eliminate DNS rebinding between resolution and the actual fetch. A stricter future treatment would use a custom lookup Adapter for direct fetches and a documented policy for proxied fetches.
