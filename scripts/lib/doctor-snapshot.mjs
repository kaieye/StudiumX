import { spawnSync } from 'node:child_process'
import { access, readFile, stat } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { basename, join } from 'node:path'

import { reconcileLearningWorkLedger } from './learning-work-reconcile.mjs'

const CHECK_TIMEOUT_MS = 60_000
const CHECK_OUTPUT_TAIL_LINES = 8
const CHECK_STATUSES = new Set(['passed', 'failed', 'timeout'])
const CHECK_CLASSIFICATIONS = new Set(['passed', 'failed', 'timeout', 'runner_error'])

/**
 * Local build identity for doctor text/json (S-12).
 * Mirrors src/shared/build-identity.ts precedence without importing TS / network / git.
 * Unknown → "unknown"; never throws; no absolute paths.
 */
function readDoctorBuildIdentity(env = process.env, pkg = null) {
  const candidates = [env?.SOURCE_REV, env?.GITHUB_SHA, env?.GIT_DESCRIBE]
  let sourceRev = 'unknown'
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed || trimmed.length > 64) continue
    if (trimmed.includes('\\') || trimmed.includes('..') || trimmed.includes('://')) continue
    if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) continue
    if (!/^[A-Za-z0-9._+/-]+$/.test(trimmed)) continue
    sourceRev = trimmed
    break
  }
  const nodeEngine =
    typeof pkg?.engines?.node === 'string' && pkg.engines.node.trim()
      ? pkg.engines.node.trim()
      : '>=22 <25'
  return { sourceRev, nodeEngine }
}

/**
 * Collect the local, content-free readiness snapshot used by the doctor CLI.
 * The caller supplies the check catalog; this module owns how that catalog is
 * executed, classified, summarized, redacted, and rendered.
 */

/**
 * ADR-0131 platform capability projection for doctor (path-free, honest names).
 * Mirrors src/main/platform/platform-capability-registry.ts without importing TS.
 * Default product story is pathname_default — not dual-profile / descriptor-strict.
 */
export function resolveDoctorPlatformCapabilities(platformName = platform()) {
  const isWin = platformName === 'win32'
  const isSupported = platformName === 'win32' || platformName === 'darwin' || platformName === 'linux'
  const profile = isSupported ? 'pathname_default' : 'unavailable'
  const available = isSupported
  const okKey = 'platformCapability.pathnameDefault'
  const writeUnavailableKey = 'platformCapability.writeUnavailable'
  const memoryMessageKey = available ? okKey : writeUnavailableKey
  const memoryOkCode = available ? 'ok' : 'write_unavailable'
  return {
    platform: platformName,
    // Keep in sync with src/main/platform/platform-capability-registry.ts
    // PLATFORM_CAPABILITY_CONSUMERS (path-free, honest names only).
    consumers: [
      {
        consumer: 'write_workspace_file',
        class: 'workspace_tool_write',
        profile,
        available,
        code: available ? 'ok' : 'unsupported_platform',
        messageKey: available ? okKey : writeUnavailableKey
      },
      {
        consumer: 'teaching_memory_chat_hot_path',
        class: 'chat_hot_path_read',
        profile: available ? profile : 'unavailable',
        available: true,
        code: available ? 'ok' : 'degraded_empty',
        messageKey: available ? okKey : 'platformCapability.memoryChatDegradedEmpty'
      },
      {
        consumer: 'teaching_memory_authority_read',
        class: 'durable_authority_read',
        profile,
        available,
        code: available ? 'ok' : 'write_unavailable',
        messageKey: memoryMessageKey
      },
      {
        consumer: 'teaching_memory_authority_write',
        class: 'durable_authority_write',
        profile,
        available,
        code: memoryOkCode,
        messageKey: memoryMessageKey
      },
      {
        consumer: 'teaching_memory_catalog',
        class: 'durable_authority_write',
        profile,
        available,
        code: memoryOkCode,
        messageKey: memoryMessageKey
      },
      {
        consumer: 'learning_outcome_committer',
        class: 'durable_authority_write',
        profile: isWin ? 'unavailable' : profile,
        available: !isWin && isSupported,
        code: isWin ? 'unsupported_platform' : (isSupported ? 'ok' : 'unsupported_platform'),
        messageKey: isWin
          ? 'platformCapability.outcomeWindowsNotStrict'
          : (isSupported ? okKey : writeUnavailableKey)
      },
      {
        consumer: 'session_audit_jsonl',
        class: 'durable_authority_write',
        profile: isWin ? 'unavailable' : profile,
        available: !isWin && isSupported,
        code: isWin ? 'unsupported_platform' : (isSupported ? 'ok' : 'unsupported_platform'),
        messageKey: isWin
          ? 'platformCapability.sessionAuditWindowsLimited'
          : (isSupported ? okKey : writeUnavailableKey)
      }
    ]
  }
}

export async function collectDoctorSnapshot(options = {}) {
  const normalized = normalizeCollectionOptions(options)
  const startedAt = Date.now()
  const packagePath = join(normalized.cwd, 'package.json')
  const settingsPath = join(normalized.userDataPath, 'studiumx-settings.json')
  const [pkg, settings, settingsInfo, gitignore, pnpmLockExists, npmLockExists, workspacePolicyExists] = await Promise.all([
    readJson(packagePath),
    readJson(settingsPath),
    fileInfo(settingsPath),
    readText(join(normalized.cwd, '.gitignore')),
    exists(join(normalized.cwd, 'pnpm-lock.yaml')),
    exists(join(normalized.cwd, 'package-lock.json')),
    exists(join(normalized.cwd, 'pnpm-workspace.yaml'))
  ])

  const rootCodexBundleFiles = []
  for (const file of ['index.js', 'desktop-CdASu-HC.js']) {
    if (await exists(join(normalized.cwd, file))) rootCodexBundleFiles.push(file)
  }

  const learningWork = [
    { scope: 'app_data', ...(await reconcileLearningWorkLedger(normalized.userDataPath)) }
  ]
  if (normalized.workspacePath) {
    learningWork.push({
      scope: 'workspace',
      ...(await reconcileLearningWorkLedger(normalized.workspacePath))
    })
  }

  const securityChecks = normalized.runChecks
    ? runSecurityChecks(normalized.checkCatalog, normalized.cwd)
    : []

  // Local process crash marker (ADR-0066): read-only facts for next-start visibility.
  // Never uploads. Clearing the marker is a separate deliberate effect.
  const processCrashMarker = await readProcessCrashMarkerFacts(normalized.userDataPath)

  const snapshot = {
    generatedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - startedAt),
    app: {
      name: pkg?.name ?? 'unknown',
      version: pkg?.version ?? 'unknown',
      productName: pkg?.build?.productName ?? 'unknown',
      packageManager: pkg?.packageManager ?? null,
      ...readDoctorBuildIdentity(process.env, pkg)
    },
    runtime: {
      node: process.version,
      platform: platform(),
      cwd: normalized.cwd
    },
    repository: {
      lockfilePolicy: {
        pnpmLock: pnpmLockExists,
        npmLock: npmLockExists,
        pnpmWorkspace: workspacePolicyExists
      },
      referenceBundleIgnored: /^ref_project\/\s*$/m.test(gitignore ?? ''),
      rootCodexBundleFiles,
      scripts: {
        security: pkg?.scripts?.['check:security'] ?? null,
        repositoryHygiene: pkg?.scripts?.['check:repository-hygiene'] ?? null
      }
    },
    paths: {
      userDataPath: normalized.userDataPath,
      settingsPath,
      logPath: join(normalized.userDataPath, 'studiumx.log')
    },
    settings: summarizeSettings(settings, settingsInfo),
    runtimePosture: summarizeRuntimePosture(settings, settingsInfo),
    platformCapabilities: resolveDoctorPlatformCapabilities(platform()),
    diagnostics: {
      mode: 'local_snapshot',
      redaction: 'home paths, secret-shaped keys, bearer tokens, URL userinfo, and sensitive query parameters',
      logExport: 'not_included',
      workspaceContent: 'not_included'
    },
    learningWork,
    securityChecks,
    processCrashMarker
  }
  snapshot.readiness = classifyDoctorChecks(snapshot.securityChecks)
  assertDoctorSnapshot(snapshot)
  return snapshot
}

/**
 * Reduce check results to a stable readiness status without relying on output
 * text or child-process exit codes at the CLI boundary.
 */
export function classifyDoctorChecks(checks) {
  if (!Array.isArray(checks)) throw new TypeError('Doctor checks must be an array.')

  const summary = {
    total: checks.length,
    passed: 0,
    failed: 0,
    timedOut: 0,
    runnerErrors: 0
  }

  for (const check of checks) {
    assertDoctorCheck(check)
    if (check.status === 'passed') summary.passed += 1
    if (check.status === 'failed') summary.failed += 1
    if (check.status === 'timeout') summary.timedOut += 1
    if (check.classification === 'runner_error') summary.runnerErrors += 1
  }

  return {
    status: summary.total === 0 ? 'checks_skipped' : summary.passed === summary.total ? 'ready' : 'attention',
    securityChecks: summary
  }
}

/** Return the portable JSON or plain-text representation of a doctor snapshot. */
export function formatDoctorReport(snapshot, format = 'text') {
  assertDoctorSnapshot(snapshot)
  if (format === 'json') return `${JSON.stringify(snapshot, null, 2)}\n`
  if (format !== 'text') throw new TypeError(`Unsupported doctor report format: ${String(format)}`)

  const lines = [
    `StudiumX doctor (${snapshot.generatedAt})`,
    `app: ${snapshot.app.name} ${snapshot.app.version} (sourceRev=${snapshot.app.sourceRev ?? 'unknown'}; nodeEngine=${snapshot.app.nodeEngine ?? 'n/a'})`,
    `userData: ${snapshot.paths.userDataPath}`,
    `settings: ${snapshot.settings.exists ? 'found' : 'missing'} (${snapshot.settings.storage})`,
    `runtime posture: approval=${snapshot.runtimePosture?.approvalMode ?? 'n/a'}; tools=${snapshot.runtimePosture?.toolsEnabled ? 'on' : 'off'}; proxy=${snapshot.runtimePosture?.proxyEnabled ? 'on' : 'off'}; keys=${snapshot.runtimePosture?.keyStorage ?? 'n/a'}; shell=${snapshot.runtimePosture?.shellExecution ?? 'n/a'}`
  ]
  if (snapshot.platformCapabilities?.consumers?.length) {
    lines.push('platform capabilities (ADR-0131 pathname-default; not descriptor-strict default):')
    for (const consumer of snapshot.platformCapabilities.consumers) {
      lines.push(
        `  - ${consumer.consumer}: profile=${consumer.profile}; available=${consumer.available}; code=${consumer.code ?? 'n/a'}`
      )
    }
  }
  if (snapshot.securityChecks.length === 0) {
    lines.push('security checks: skipped')
  } else {
    lines.push(`security checks: ${snapshot.readiness.securityChecks.passed}/${snapshot.readiness.securityChecks.total} passed`)
    for (const check of snapshot.securityChecks.filter((check) => check.status !== 'passed')) {
      lines.push(`- ${check.script}: ${check.status}`)
    }
  }
  for (const ledger of snapshot.learningWork) {
    lines.push(`learning work (${ledger.scope}): ${ledger.status}, ${ledger.conversations} conversation(s)`)
  }
  if (snapshot.processCrashMarker && typeof snapshot.processCrashMarker === 'object') {
    const marker = snapshot.processCrashMarker
    if (marker.present === true) {
      lines.push(`process crash marker: present${marker.reasonCode ? ` (${marker.reasonCode})` : ''}${marker.writtenAt ? ` at ${marker.writtenAt}` : ''}`)
    } else {
      lines.push('process crash marker: absent')
    }
  }
  for (const line of formatBackupPolicyDoctorLines()) {
    lines.push(line)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Doctor uses a binary CLI result: complete security coverage passes with 0;
 * every failed, timed-out, malformed, or unavailable check returns 1.
 */
export function calculateDoctorExitCode(snapshot) {
  try {
    assertDoctorSnapshot(snapshot)
  } catch {
    return 1
  }
  return snapshot.securityChecks.every((check) => check.status === 'passed') ? 0 : 1
}

/** Create a presentation-safe copy; the collected snapshot remains unchanged. */
export function redactDoctorSnapshot(snapshot) {
  assertDoctorSnapshot(snapshot)
  return redactValue(snapshot)
}

/** Operator-facing backup vs disposable projection lines (DB-P1-5). */
export function formatBackupPolicyDoctorLines() {
  return [
    'backup policy: must backup workspace files + Memory + learning-work JSONL + settings (desensitize secrets)',
    'backup policy: disposable projections = studiumx-index.sqlite* / quarantined / caches / diagnostic logs (safe to delete; rebuild restores)',
    'export default: exclude disposable projections; optional includeProjections is debug-only and untrusted'
  ]
}

export function defaultDoctorUserDataPath() {
  const home = homedir()
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'StudiumX')
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'StudiumX')
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'StudiumX')
}

function normalizeCollectionOptions(options) {
  if (!isRecord(options)) throw new TypeError('Doctor collection options must be an object.')

  const cwd = options.cwd ?? process.cwd()
  const userDataPath = options.userDataPath ?? defaultDoctorUserDataPath()
  const workspacePath = options.workspacePath ?? null
  const runChecks = options.runChecks ?? true
  const checkCatalog = options.checkCatalog ?? []

  if (!isNonEmptyString(cwd)) throw new TypeError('Doctor cwd must be a non-empty path.')
  if (!isNonEmptyString(userDataPath)) throw new TypeError('Doctor userDataPath must be a non-empty path.')
  if (workspacePath !== null && !isNonEmptyString(workspacePath)) {
    throw new TypeError('Doctor workspacePath must be a non-empty path when provided.')
  }
  if (typeof runChecks !== 'boolean') throw new TypeError('Doctor runChecks must be a boolean.')
  if (!Array.isArray(checkCatalog) || checkCatalog.some((script) => !isNonEmptyString(script))) {
    throw new TypeError('Doctor checkCatalog must contain non-empty script paths.')
  }
  if (new Set(checkCatalog).size !== checkCatalog.length) {
    throw new TypeError('Doctor checkCatalog must not contain duplicate script paths.')
  }

  return { cwd, userDataPath, workspacePath, runChecks, checkCatalog }
}

function runSecurityChecks(checkCatalog, cwd) {
  return checkCatalog.map((script) => {
    const startedAt = Date.now()
    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 8,
      timeout: CHECK_TIMEOUT_MS
    })
    const classification = classifyCheckResult(result)
    return {
      id: basename(script).replace(/^check-/, '').replace(/\.mjs$/, ''),
      script,
      status: classification === 'passed' ? 'passed' : classification === 'timeout' ? 'timeout' : 'failed',
      classification,
      exitCode: Number.isInteger(result.status) ? result.status : null,
      durationMs: Math.max(0, Date.now() - startedAt),
      outputTail: compactOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    }
  })
}

function classifyCheckResult(result) {
  if (result.error?.code === 'ETIMEDOUT') return 'timeout'
  if (result.error) return 'runner_error'
  return result.status === 0 ? 'passed' : 'failed'
}


function summarizeRuntimePosture(settings, info) {
  const tools = settings?.tools ?? {}
  const provider = settings?.provider ?? {}
  const secret = summarizeSecretStorage(settings)
  return {
    approvalMode: stringValue(tools.approvalMode) ?? 'request_approval',
    toolsEnabled: tools.enabled === true,
    workspaceRead: tools.workspaceRead !== false,
    webSearch: tools.webSearch !== false,
    webFetch: tools.webFetch === true,
    proxyEnabled: provider?.proxy?.enabled === true,
    proxyHostOnly: Boolean(provider?.proxy?.enabled) && !Boolean(stringValue(provider?.proxy?.url)?.includes('@')),
    keyStorage: secret.keyStorage,
    safeStorage: secret.keyStorage === 'electron_safe_storage' ? 'available_or_in_use' : secret.keyStorage === 'no_stored_secrets' ? 'not_required' : 'see_keyStorage',
    settingsFilePresent: Boolean(info),
    nativeAddonNote: 'default durable I/O is pathname_default (ADR-0131); native descriptor is not default; see platformCapabilities for booleans',
    shellExecution: 'not_productized',
    mcpMarketplace: 'not_productized'
  }
}

function summarizeSettings(settings, info) {
  if (!settings) {
    return {
      storage: 'json_file',
      exists: false,
      keyStorage: 'no_stored_secrets',
      keychainMigration: 'not_required',
      note: 'Settings file not found; app will use defaults on launch.'
    }
  }
  const providers = Array.isArray(settings.provider?.providers) ? settings.provider.providers : []
  const endpointFormats = [...new Set(providers.map((provider) => provider?.endpointFormat).filter(Boolean))]
  const secretStorage = summarizeSecretStorage(settings)
  return {
    storage: 'json_file',
    exists: true,
    fileMode: info?.mode ?? null,
    privateFileMode: info?.privateFileMode ?? null,
    ...secretStorage,
    provider: {
      activeProviderId: stringValue(settings.provider?.activeProviderId),
      providerCount: providers.length,
      endpointFormats,
      proxyEnabled: settings.provider?.proxy?.enabled === true
    },
    tools: {
      enabled: settings.tools?.enabled === true,
      workspaceRead: settings.tools?.workspaceRead !== false,
      approvalMode: stringValue(settings.tools?.approvalMode),
      webSearch: settings.tools?.webSearch !== false,
      webFetch: settings.tools?.webFetch === true
    },
    workspacePathPolicy: {
      defaultRootConfigured: Boolean(stringValue(settings.workspace?.defaultRoot)),
      worktreeRootConfigured: Boolean(stringValue(settings.worktree?.rootPath))
    },
    privacy: {
      maskApiKeys: settings.privacy?.maskApiKeys !== false,
      allowExternalLinks: settings.privacy?.allowExternalLinks !== false
    },
    log: {
      enabled: settings.log?.enabled !== false,
      retentionDays: numberValue(settings.log?.retentionDays)
    }
  }
}

function summarizeSecretStorage(settings) {
  if (!settings || typeof settings !== "object") {
    return { keyStorage: "no_stored_secrets", keychainMigration: "not_required" }
  }
  const values = []
  const providers = Array.isArray(settings.provider?.providers) ? settings.provider.providers : []
  for (const provider of providers) values.push(stringValue(provider?.apiKey) ?? '')
  values.push(stringValue(settings.provider?.proxy?.url) ?? '')
  for (const key of ['braveApiKey', 'firecrawlApiKey', 'tavilyApiKey', 'exaApiKey', 'parallelApiKey', 'xaiApiKey']) {
    values.push(stringValue(settings.webSearch?.[key]) ?? '')
  }
  const stored = values.filter(Boolean)
  if (stored.length === 0) return { keyStorage: 'no_stored_secrets', keychainMigration: 'not_required' }
  const encrypted = stored.filter((value) => value.startsWith('safeStorage:v1:')).length
  if (encrypted === stored.length) return { keyStorage: 'electron_safe_storage', keychainMigration: 'complete' }
  if (encrypted > 0) return { keyStorage: 'mixed_plaintext_and_safe_storage', keychainMigration: 'partial' }
  return { keyStorage: 'settings_json', keychainMigration: 'pending_app_launch' }
}

async function fileInfo(path) {
  try {
    const info = await stat(path)
    const modeBits = info.mode & 0o777
    return {
      mode: `0o${modeBits.toString(8).padStart(3, '0')}`,
      privateFileMode: (modeBits & 0o077) === 0
    }
  } catch {
    return null
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function compactOutput(value) {
  return value
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-CHECK_OUTPUT_TAIL_LINES)
}

function redactValue(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]))
  }
  if (typeof value !== 'string') return value
  if (isSensitiveKey(key)) return '[REDACTED]'
  return redactText(value)
}

function redactText(value) {
  let out = value
  const home = homedir()
  if (home) out = out.split(home).join('~')
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
  out = out.replace(/((?:api[_-]?key|token|secret|password|credential)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
  out = out.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@')
  return out
}

function isSensitiveKey(key) {
  return /(?:api[_-]?key|token|secret|password|credential|authorization)$/i.test(key)
}

function assertDoctorSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Doctor snapshot must be an object.')
  if (typeof snapshot.generatedAt !== 'string') throw new TypeError('Doctor snapshot generatedAt must be a string.')
  if (!Number.isFinite(snapshot.durationMs) || snapshot.durationMs < 0) {
    throw new TypeError('Doctor snapshot durationMs must be a non-negative number.')
  }
  if (!isRecord(snapshot.app) || !isRecord(snapshot.paths) || !isRecord(snapshot.settings) || !isRecord(snapshot.runtimePosture)) {
    throw new TypeError('Doctor snapshot is missing required report sections.')
  }
  if (!Array.isArray(snapshot.learningWork) || !Array.isArray(snapshot.securityChecks)) {
    throw new TypeError('Doctor snapshot collections must be arrays.')
  }
  for (const check of snapshot.securityChecks) assertDoctorCheck(check)

  const readiness = classifyDoctorChecks(snapshot.securityChecks)
  if (!isRecord(snapshot.readiness) || snapshot.readiness.status !== readiness.status) {
    throw new TypeError('Doctor snapshot readiness does not match its security checks.')
  }
  if (!isRecord(snapshot.readiness.securityChecks)) {
    throw new TypeError('Doctor snapshot readiness counts must be an object.')
  }
  for (const [key, value] of Object.entries(readiness.securityChecks)) {
    if (snapshot.readiness.securityChecks[key] !== value) {
      throw new TypeError('Doctor snapshot readiness counts do not match its security checks.')
    }
  }
}

function assertDoctorCheck(check) {
  if (!isRecord(check) || !isNonEmptyString(check.id) || !isNonEmptyString(check.script)) {
    throw new TypeError('Doctor check records require id and script strings.')
  }
  if (check.exitCode !== null && !Number.isInteger(check.exitCode)) {
    throw new TypeError('Doctor check exitCode must be an integer or null.')
  }
  if (!Number.isFinite(check.durationMs) || check.durationMs < 0) {
    throw new TypeError('Doctor check durationMs must be a non-negative number.')
  }
  if (!Array.isArray(check.outputTail) || check.outputTail.some((line) => typeof line !== 'string')) {
    throw new TypeError('Doctor check outputTail must be an array of strings.')
  }
  if (!CHECK_STATUSES.has(check.status) || !CHECK_CLASSIFICATIONS.has(check.classification)) {
    throw new TypeError('Doctor check has an unsupported status or classification.')
  }
  if (check.status === 'passed' && check.classification !== 'passed') {
    throw new TypeError('A passed doctor check must have a passed classification.')
  }
  if (check.status === 'timeout' && check.classification !== 'timeout') {
    throw new TypeError('A timed-out doctor check must have a timeout classification.')
  }
  if (check.status === 'failed' && !['failed', 'runner_error'].includes(check.classification)) {
    throw new TypeError('A failed doctor check must have a failure classification.')
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function stringValue(value) {
  return typeof value === 'string' ? value : null
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Read local crash-marker facts under appData/observability (fail-closed).
 * Mirrors src/main/observability/process-crash-marker-facts.ts shape for CLI doctor.
 * Pure read: never clears or uploads.
 */
async function readProcessCrashMarkerFacts(userDataPath) {
  const markerPath = join(userDataPath, 'observability', 'crash-marker.json')
  try {
    const raw = await readFile(markerPath, 'utf8')
    return mapProcessCrashMarkerFacts(raw)
  } catch {
    return { present: false }
  }
}

/** Pure map of crash-marker JSON text -> TeachingDoctor-compatible facts. */
export function mapProcessCrashMarkerFacts(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return { present: false }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { present: false }
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) return { present: false }
  if (typeof parsed.writtenAt !== 'string' || !parsed.writtenAt.trim()) return { present: false }
  for (const key of Object.keys(parsed)) {
    if (key === 'schemaVersion' || key === 'writtenAt' || key === 'reasonCode' || key === 'runId') continue
    return { present: false }
  }
  if (typeof parsed.reasonCode !== 'string' || !parsed.reasonCode.trim()) return { present: false }
  if (looksLikePathOrSecret(parsed.writtenAt)) return { present: false }
  const runId =
    typeof parsed.runId === 'string' &&
    parsed.runId.trim() &&
    !looksLikePathOrSecret(parsed.runId) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(parsed.runId.trim())
      ? parsed.runId.trim()
      : null
  return {
    present: true,
    writtenAt: parsed.writtenAt.trim(),
    reasonCode: parsed.reasonCode.trim().slice(0, 64),
    ...(runId ? { runId } : {})
  }
}

function looksLikePathOrSecret(value) {
  if (typeof value !== 'string') return true
  if (/[\\/]/.test(value)) return true
  if (/^[A-Za-z]:/.test(value)) return true
  if (/api[_-]?key|secret|token|password|bearer/i.test(value)) return true
  return false
}
