/**
 * Build / source identity for local diagnostics (ADOPTION S-12 / ADR-0072).
 *
 * Pure, fail-closed, no network. Prefer build-time env injection; never phone-home.
 * Unknown → stable placeholder `"unknown"` (does not throw; no absolute paths; no secrets).
 */

export type BuildIdentity = {
  /** Short source revision label for doctor / support (not a full SBOM). */
  sourceRev: string
  /** Declared package.json engines.node when available; optional. */
  nodeEngine?: string
}

export const UNKNOWN_SOURCE_REV = 'unknown' as const

/** Declared Node engine range for StudiumX tooling / CI (major 22 family). */
export const DECLARED_NODE_ENGINE = '>=22 <25' as const

export type BuildIdentityEnv = {
  SOURCE_REV?: string | undefined
  GITHUB_SHA?: string | undefined
  /** Optional precomputed git describe / tag label when available at build time. */
  GIT_DESCRIBE?: string | undefined
  /** Optional engines.node string when injectors already resolved package.json. */
  NODE_ENGINE?: string | undefined
  [key: string]: string | undefined
}

const MAX_REV_LEN = 64
const MAX_ENGINE_LEN = 32
const SAFE_REV = /^[A-Za-z0-9._+/-]+$/
const SAFE_ENGINE = /^[A-Za-z0-9._+<>=| -]+$/

/**
 * Sanitize a candidate revision string.
 * Rejects empty, path-like, whitespace, secrets-shaped noise; caps length.
 */
export function sanitizeSourceRev(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_REV_LEN) return null
  // Reject absolute / relative path fragments and shell-ish noise.
  if (trimmed.includes('\\') || trimmed.includes('..') || trimmed.includes('://')) return null
  if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) return null
  if (!SAFE_REV.test(trimmed)) return null
  return trimmed
}

function sanitizeNodeEngine(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_ENGINE_LEN) return null
  if (trimmed.includes('\\') || trimmed.includes('..') || trimmed.includes('://')) return null
  if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) return null
  if (!SAFE_ENGINE.test(trimmed)) return null
  return trimmed
}

/**
 * Resolve source revision from env with stable precedence:
 * 1. SOURCE_REV (explicit build inject)
 * 2. GITHUB_SHA (CI)
 * 3. GIT_DESCRIBE (optional build-time git describe)
 * 4. unknown
 */
export function resolveSourceRev(env: BuildIdentityEnv = {}): string {
  for (const key of ['SOURCE_REV', 'GITHUB_SHA', 'GIT_DESCRIBE'] as const) {
    const cleaned = sanitizeSourceRev(env[key])
    if (cleaned) return cleaned
  }
  return UNKNOWN_SOURCE_REV
}

/**
 * Read local build identity. Defaults to process.env when env is omitted.
 * Does not shell out to git and does not touch the network.
 */
export function readBuildIdentity(env: BuildIdentityEnv = process.env as BuildIdentityEnv): BuildIdentity {
  const sourceRev = resolveSourceRev(env)
  const nodeEngine =
    sanitizeNodeEngine(env.NODE_ENGINE) ??
    sanitizeNodeEngine(DECLARED_NODE_ENGINE) ??
    DECLARED_NODE_ENGINE
  return {
    sourceRev,
    nodeEngine
  }
}
