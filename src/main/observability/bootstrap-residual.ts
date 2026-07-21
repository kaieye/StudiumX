/**
 * Local crash-marker main-process bootstrap status (B-11 / ADR-0066 + ADR-0084).
 *
 * Wired in `src/main/index.ts` after `userDataPath` is known:
 *
 * ```ts
 * import { createCrashMarkerStore, installLocalCrashMarkerHooks } from './observability'
 * const crashMarkers = createCrashMarkerStore({ appDataRoot: userDataPath })
 * uninstallCrashMarkerHooks = installLocalCrashMarkerHooks(crashMarkers)
 * // product doctor IPC:
 * registerTeachingIpcGateway({ ..., crashMarkerStore: crashMarkers })
 * ```
 *
 * Product IPC `runTeachingDoctor` assembles `processCrashMarker` via
 * `runProductTeachingDoctor` + `collectProcessCrashMarkerFacts`, then pure
 * `runTeachingDoctor` / `exportTeachingDoctorReport`. Doctor remains pure /
 * read-only; clearing the marker is a separate deliberate effect.
 *
 * Residual after ADR-0084 / ADR-0107: rich Settings Doctor UI panel remains
 * optional polish. Multi-collector workspace facts (session/outcome/config/
 * source/catalog) are product-wired where collectors exist. Support-bundle
 * common path/secret redaction now uses shared observability/redact (ADR-0107);
 * public re-export of support-bundle internals remains intentionally closed.
 *
 * Non-claims: no auto-upload, no OTEL/Statsig/Mixpanel, no remote telemetry,
 * no auto-clear of crash marker on doctor run, no auto-repair.
 *
 * Status constant kept for unit assertions / ADOPTION residual wording.
 */
export const LOCAL_CRASH_MARKER_BOOTSTRAP_RESIDUAL = 'main-process-hook-wired+product-ipc' as const
