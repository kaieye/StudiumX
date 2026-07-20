/**
 * Optimistic concurrency contract for teaching config / settings writes.
 *
 * Callers supply the fingerprint they last observed; the pure CAS core
 * compares it against the currently resolved secret-free snapshot and either
 * projects the next overlay or returns a structured conflict / invalid result.
 * Persistence adapters own I/O; this module never invents secret values into
 * the fingerprint surface.
 */

export const CONFIG_OPTIMISTIC_WRITE_SCHEMA_VERSION = 1 as const

export type ConfigOptimisticWriteSchemaVersion = typeof CONFIG_OPTIMISTIC_WRITE_SCHEMA_VERSION

/** Layer that receives the write overlay when CAS succeeds. */
export type ConfigWriteLayer = 'user' | 'workspace'

/**
 * Client write request. `next` is a TeachingSettingsPatch-like overlay
 * (or any plain object the resolver can layer). Secrets present in `next`
 * are rejected before any apply.
 */
export type ConfigWriteRequest = {
  expectedFingerprint: string
  /** TeachingSettingsPatch-like overlay or unknown plain object. */
  next: unknown
  /** Defaults to `user` when omitted. */
  layer?: ConfigWriteLayer
}

export type ConfigWriteSuccess = {
  ok: true
  fingerprint: string
  /** Secret-free resolved value after the projected write. */
  value?: unknown
}

export type ConfigWriteConflictCode = 'fingerprint_mismatch'

export type ConfigWriteInvalidCode =
  | 'invalid_input'
  | 'secret_path_rejected'
  | 'invalid_layer'
  | 'invalid_fingerprint'

export type ConfigWriteConflict = {
  ok: false
  code: ConfigWriteConflictCode
  currentFingerprint: string
  message: string
}

export type ConfigWriteInvalid = {
  ok: false
  code: ConfigWriteInvalidCode
  message: string
}

export type ConfigWriteResult = ConfigWriteSuccess | ConfigWriteConflict | ConfigWriteInvalid

/**
 * Thin store adapter for optional durable CAS wrapping. Implementations map
 * onto TeachingSettingsStore / file writers; the pure core never calls them.
 */
export type ConfigOptimisticStoreRead = {
  fingerprint: string
  /** Current user-layer document (TeachingSettingsV1-shaped or unknown). */
  user?: unknown
  /** Current workspace overlay (optional). */
  workspace?: unknown
  /** Fallback root used when resolving defaults. */
  fallbackDefaultRoot?: string
}

export type ConfigOptimisticStore = {
  read(): Promise<ConfigOptimisticStoreRead>
  /**
   * Atomically persist the CAS-projected next overlay for the chosen layer.
   * Must not partially apply when the underlying store supports atomic replace.
   */
  writeAtomic(input: {
    layer: ConfigWriteLayer
    nextOverlay: unknown
    fingerprint: string
  }): Promise<void>
}