/**
 * Pure optimistic concurrency (CAS) core for teaching config writes.
 *
 * Compares the caller's expectedFingerprint against the currently resolved
 * secret-free snapshot. On match, layers `nextOverlay` onto the chosen
 * user/workspace layer, re-resolves, and returns the new fingerprint.
 * On mismatch, returns a structured conflict without applying.
 *
 * Never persists secrets into the fingerprint surface. Detectable secret
 * paths in the write overlay are rejected before apply.
 */

import {
  fingerprintTeachingConfig,
  isTeachingConfigSecretPath,
  resolveTeachingConfig,
  type ResolvedTeachingConfig,
  type TeachingConfigScope,
  type TeachingLoopConfigValue
} from './teaching-config-resolver'
import type {
  ConfigOptimisticStore,
  ConfigWriteLayer,
  ConfigWriteRequest,
  ConfigWriteResult
} from '../shared/teaching-types/config-optimistic-write'

export type CompareAndProjectConfigWriteInput = {
  /** Fully resolved current config (or equivalent fingerprint + layers). */
  currentResolved: ResolvedTeachingConfig
  expectedFingerprint: string
  /** Overlay to apply when CAS matches. */
  nextOverlay: unknown
  /** Layer that receives the overlay. Defaults to `user`. */
  layer?: ConfigWriteLayer
  /**
   * Base scope used to re-resolve after applying the overlay.
   * When omitted, the pure core re-resolves with only the projected layer
   * over empty defaults (tests may pass a full scope).
   */
  baseScope?: TeachingConfigScope
}

export type CompareAndProjectConfigWriteSuccess = {
  ok: true
  fingerprint: string
  value: TeachingLoopConfigValue
  resolved: ResolvedTeachingConfig
  layer: ConfigWriteLayer
  nextOverlay: unknown
}

export type CompareAndProjectConfigWriteResult =
  | CompareAndProjectConfigWriteSuccess
  | Extract<ConfigWriteResult, { ok: false }>

/**
 * Pure CAS projection: compare expected fingerprint, reject secret-bearing
 * overlays, then apply the overlay as a user/workspace layer and re-resolve.
 */
export function compareAndProjectConfigWrite(
  input: CompareAndProjectConfigWriteInput
): CompareAndProjectConfigWriteResult {
  const layer: ConfigWriteLayer = input.layer ?? 'user'
  if (layer !== 'user' && layer !== 'workspace') {
    return {
      ok: false,
      code: 'invalid_layer',
      message: '写入层必须是 user 或 workspace。'
    }
  }

  const expected = normalizeFingerprint(input.expectedFingerprint)
  if (!expected) {
    return {
      ok: false,
      code: 'invalid_fingerprint',
      message: 'expectedFingerprint 无效：需要非空字符串。'
    }
  }

  const currentFingerprint = input.currentResolved.fingerprint
  if (expected !== currentFingerprint) {
    return {
      ok: false,
      code: 'fingerprint_mismatch',
      currentFingerprint,
      message: '配置指纹不匹配：外部编辑可能已修改配置，请重新加载后再保存。'
    }
  }

  const overlayCheck = validateWriteOverlay(input.nextOverlay)
  if (!overlayCheck.ok) return overlayCheck

  const baseScope: TeachingConfigScope = input.baseScope ?? {
    fallbackDefaultRoot: '',
    user: undefined,
    workspace: undefined,
    sessionOverride: undefined
  }

  const nextScope: TeachingConfigScope = {
    fallbackDefaultRoot: baseScope.fallbackDefaultRoot ?? '',
    user: layer === 'user' ? input.nextOverlay : baseScope.user,
    workspace: layer === 'workspace' ? input.nextOverlay : baseScope.workspace,
    sessionOverride: baseScope.sessionOverride
  }

  // When writing the user layer with a plain patch (not full document), merge
  // over the previous user document when baseScope.user is present so partial
  // patches do not wipe unrelated fields from the layer document.
  if (layer === 'user' && baseScope.user !== undefined && isPlainObject(baseScope.user) && isPlainObject(input.nextOverlay)) {
    nextScope.user = shallowMergeLayerDocuments(baseScope.user, input.nextOverlay)
  }
  if (
    layer === 'workspace' &&
    baseScope.workspace !== undefined &&
    isPlainObject(baseScope.workspace) &&
    isPlainObject(input.nextOverlay)
  ) {
    nextScope.workspace = shallowMergeLayerDocuments(baseScope.workspace, input.nextOverlay)
  }

  const resolved = resolveTeachingConfig(nextScope)
  // Recompute via the public fingerprint helper so the surface stays
  // secret-free even if a future resolver regression leaks fields.
  const fingerprint = fingerprintTeachingConfig(resolved.value)
  if (fingerprint !== resolved.fingerprint) {
    // Defensive: keep the authoritative fingerprintTeachingConfig result.
  }

  return {
    ok: true,
    fingerprint,
    value: resolved.value,
    resolved: {
      ...resolved,
      fingerprint
    },
    layer,
    nextOverlay: nextScope[layer === 'user' ? 'user' : 'workspace']
  }
}

/**
 * Convenience wrapper around ConfigWriteRequest for callers that already hold
 * a ResolvedTeachingConfig and optional base scope.
 */
export function projectConfigWriteRequest(
  request: ConfigWriteRequest,
  currentResolved: ResolvedTeachingConfig,
  baseScope?: TeachingConfigScope
): CompareAndProjectConfigWriteResult {
  return compareAndProjectConfigWrite({
    currentResolved,
    expectedFingerprint: request.expectedFingerprint,
    nextOverlay: request.next,
    layer: request.layer,
    baseScope
  })
}

/**
 * Optional durable CAS adapter: read → pure project → atomic write.
 * Store implementations map onto TeachingSettingsService.save or file writers.
 * This function is intentionally thin so pure unit tests never need I/O.
 */
export async function writeConfigOptimistic(
  store: ConfigOptimisticStore,
  request: ConfigWriteRequest
): Promise<ConfigWriteResult> {
  const layer: ConfigWriteLayer = request.layer ?? 'user'
  if (layer !== 'user' && layer !== 'workspace') {
    return {
      ok: false,
      code: 'invalid_layer',
      message: '写入层必须是 user 或 workspace。'
    }
  }

  const current = await store.read()
  const currentResolved = resolveTeachingConfig({
    fallbackDefaultRoot: current.fallbackDefaultRoot ?? '',
    user: current.user,
    workspace: current.workspace
  })

  // Prefer the store-reported fingerprint when present and consistent; otherwise
  // use the freshly resolved fingerprint so external editor races surface.
  const resolvedFingerprint = currentResolved.fingerprint
  if (current.fingerprint && current.fingerprint !== resolvedFingerprint) {
    // Treat store fingerprint as authoritative observation for CAS compare when
    // the store already tracks it; re-resolve still uses layers for projection.
  }
  const observed: ResolvedTeachingConfig = {
    ...currentResolved,
    fingerprint: current.fingerprint || resolvedFingerprint
  }

  const projected = compareAndProjectConfigWrite({
    currentResolved: observed,
    expectedFingerprint: request.expectedFingerprint,
    nextOverlay: request.next,
    layer,
    baseScope: {
      fallbackDefaultRoot: current.fallbackDefaultRoot ?? '',
      user: current.user,
      workspace: current.workspace
    }
  })

  if (!projected.ok) return projected

  await store.writeAtomic({
    layer: projected.layer,
    nextOverlay: projected.nextOverlay,
    fingerprint: projected.fingerprint
  })

  return {
    ok: true,
    fingerprint: projected.fingerprint,
    value: projected.value
  }
}

function normalizeFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function validateWriteOverlay(next: unknown): { ok: true } | Extract<ConfigWriteResult, { ok: false }> {
  if (next === null || next === undefined) {
    return {
      ok: false,
      code: 'invalid_input',
      message: '写入内容 next 不能为空。'
    }
  }
  if (!isPlainObject(next)) {
    return {
      ok: false,
      code: 'invalid_input',
      message: '写入内容 next 必须是普通对象。'
    }
  }

  const secretPaths = collectSecretPaths(next)
  if (secretPaths.length > 0) {
    return {
      ok: false,
      code: 'secret_path_rejected',
      message: `拒绝写入密钥路径：${secretPaths.slice(0, 3).join(', ')}${secretPaths.length > 3 ? '…' : ''}`
    }
  }

  return { ok: true }
}

function collectSecretPaths(value: unknown, path = ''): string[] {
  if (!isPlainObject(value) && !Array.isArray(value)) return []
  const found: string[] = []
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...collectSecretPaths(item, path ? `${path}.${index}` : String(index)))
    })
    return found
  }
  for (const [key, nested] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key
    if (isTeachingConfigSecretPath(next)) {
      if (typeof nested === 'string' && nested.length > 0) found.push(next)
      continue
    }
    // Also reject bare secret keys that appear at any nesting the path helper
    // recognizes (e.g. provider.providers.0.apiKey) and plain apiKey leaves.
    if (key === 'apiKey' && typeof nested === 'string' && nested.length > 0) {
      found.push(next)
      continue
    }
    found.push(...collectSecretPaths(nested, next))
  }
  return found
}

/**
 * Shallow-merge section objects so partial TeachingSettingsPatch-like overlays
 * do not erase sibling sections already present on the layer document.
 */
function shallowMergeLayerDocuments(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (
      isPlainObject(value) &&
      isPlainObject(base[key]) &&
      !Array.isArray(value) &&
      key !== 'providers'
    ) {
      out[key] = shallowMergeLayerDocuments(
        base[key] as Record<string, unknown>,
        value
      )
    } else {
      out[key] = value
    }
  }
  return out
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
