/**
 * Pure mapping from local CrashMarker store reads to TeachingDoctor facts.
 *
 * Collector I/O stays outside TeachingDoctor: call `store.read()`, then map
 * with `toProcessCrashMarkerFacts`. Doctor remains pure/read-only; clearing
 * the marker is a separate deliberate effect.
 *
 * Non-claims: no upload, OTEL, Statsig, Mixpanel, or remote telemetry.
 */

import type { TeachingDoctorProcessCrashMarkerFacts } from '../../shared/teaching-types/teaching-doctor'
import type { CrashMarker } from './crash-marker'

/**
 * Map a crash marker (or absence) into TeachingDoctor process-crash facts.
 * Never embeds absolute paths or secrets.
 */
export function toProcessCrashMarkerFacts(
  marker: CrashMarker | null | undefined
): TeachingDoctorProcessCrashMarkerFacts {
  if (marker == null) {
    return { present: false }
  }
  return {
    present: true,
    writtenAt: marker.writtenAt,
    reasonCode: marker.reasonCode,
    ...(marker.runId ? { runId: marker.runId } : {})
  }
}

/**
 * Async collector helper: read store then map. Best-effort; never throws.
 */
export async function collectProcessCrashMarkerFacts(store: {
  read(): Promise<CrashMarker | null>
}): Promise<TeachingDoctorProcessCrashMarkerFacts> {
  try {
    const marker = await store.read()
    return toProcessCrashMarkerFacts(marker)
  } catch {
    return { present: false }
  }
}
