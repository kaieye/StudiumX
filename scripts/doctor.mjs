#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { access, readFile, stat } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { basename, join } from 'node:path'

import { SECURITY_CHECKS } from './security-checks.mjs'
import { reconcileLearningWorkLedger } from './lib/learning-work-reconcile.mjs'

const args = process.argv.slice(2)
const argSet = new Set(args)

if (argSet.has('--help') || argSet.has('-h')) {
  printHelp()
  process.exit(0)
}

const jsonOutput = argSet.has('--json')
const redacted = !argSet.has('--no-redacted')
const runChecks = !argSet.has('--no-checks')
const userDataPath = valueForArg('--user-data') ?? process.env.STUDIUMX_USER_DATA ?? defaultUserDataPath()
const workspacePath = valueForArg('--workspace')
const startedAt = Date.now()

const snapshot = redactIfNeeded(await buildDoctorSnapshot({ userDataPath, workspacePath, runChecks }), redacted)

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`)
} else {
  printTextSnapshot(snapshot)
}

if (snapshot.securityChecks?.some((check) => check.status !== 'passed')) {
  process.exitCode = 1
}

async function buildDoctorSnapshot(options) {
  const pkg = await readJson('package.json')
  const settingsPath = join(options.userDataPath, 'studiumx-settings.json')
  const settings = await readJson(settingsPath)
  const settingsInfo = await fileInfo(settingsPath)
  const gitignore = await readText('.gitignore')
  const pnpmLockExists = await exists('pnpm-lock.yaml')
  const npmLockExists = await exists('package-lock.json')
  const workspacePolicyExists = await exists('pnpm-workspace.yaml')
  const rootCodexBundleFiles = []
  for (const file of ['index.js', 'desktop-CdASu-HC.js']) {
    if (await exists(file)) rootCodexBundleFiles.push(file)
  }
  const learningWork = [
    { scope: 'app_data', ...(await reconcileLearningWorkLedger(options.userDataPath)) }
  ]
  if (options.workspacePath) {
    learningWork.push({
      scope: 'workspace',
      ...(await reconcileLearningWorkLedger(options.workspacePath))
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    app: {
      name: pkg?.name ?? 'unknown',
      version: pkg?.version ?? 'unknown',
      productName: pkg?.build?.productName ?? 'unknown',
      packageManager: pkg?.packageManager ?? null
    },
    runtime: {
      node: process.version,
      platform: platform(),
      cwd: process.cwd()
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
      userDataPath: options.userDataPath,
      settingsPath,
      logPath: join(options.userDataPath, 'studiumx.log')
    },
    settings: summarizeSettings(settings, settingsInfo),
    diagnostics: {
      mode: 'local_snapshot',
      redaction: 'home paths, secret-shaped keys, bearer tokens, URL userinfo, and sensitive query parameters',
      logExport: 'not_included',
      workspaceContent: 'not_included'
    },
    learningWork,
    securityChecks: options.runChecks ? runSecurityChecks() : []
  }
}

function runSecurityChecks() {
  return SECURITY_CHECKS.map((script) => {
    const start = Date.now()
    const result = spawnSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 8,
      timeout: 60_000
    })
    const timedOut = result.error && result.error.code === 'ETIMEDOUT'
    const output = compactOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    return {
      id: basename(script).replace(/^check-/, '').replace(/\.mjs$/, ''),
      script,
      status: timedOut ? 'timeout' : result.status === 0 ? 'passed' : 'failed',
      exitCode: result.status,
      durationMs: Date.now() - start,
      outputTail: output
    }
  })
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
      workspaceWritePermission: stringValue(settings.tools?.workspaceWritePermission),
      webSearch: settings.tools?.webSearch !== false,
      webFetch: settings.tools?.webFetch === true,
      maxIterations: numberValue(settings.tools?.maxIterations)
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
  const values = []
  const providers = Array.isArray(settings.provider?.providers) ? settings.provider.providers : []
  for (const provider of providers) values.push(stringValue(provider?.apiKey) ?? '')
  values.push(stringValue(settings.provider?.proxy?.url) ?? '')
  for (const key of [
    'braveApiKey',
    'firecrawlApiKey',
    'tavilyApiKey',
    'exaApiKey',
    'parallelApiKey',
    'xaiApiKey'
  ]) {
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
  const lines = value
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
  return lines.slice(-8)
}

function redactIfNeeded(value, enabled) {
  if (!enabled) return value
  return redactValue(value)
}

function redactValue(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redactValue(childValue, childKey)
    }
    return out
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

function stringValue(value) {
  return typeof value === 'string' ? value : null
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function valueForArg(name) {
  const equalsPrefix = `${name}=`
  const inline = args.find((arg) => arg.startsWith(equalsPrefix))
  if (inline) return inline.slice(equalsPrefix.length)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

function defaultUserDataPath() {
  const home = homedir()
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'StudiumX')
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'StudiumX')
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'StudiumX')
}

function printTextSnapshot(snapshot) {
  console.log(`StudiumX doctor (${snapshot.generatedAt})`)
  console.log(`app: ${snapshot.app.name} ${snapshot.app.version}`)
  console.log(`userData: ${snapshot.paths.userDataPath}`)
  console.log(`settings: ${snapshot.settings.exists ? 'found' : 'missing'} (${snapshot.settings.storage})`)
  if (snapshot.securityChecks.length === 0) {
    console.log('security checks: skipped')
    return
  }
  const failed = snapshot.securityChecks.filter((check) => check.status !== 'passed')
  console.log(`security checks: ${snapshot.securityChecks.length - failed.length}/${snapshot.securityChecks.length} passed`)
  for (const check of failed) {
    console.log(`- ${check.script}: ${check.status}`)
  }
  for (const ledger of snapshot.learningWork ?? []) {
    console.log(`learning work (${ledger.scope}): ${ledger.status}, ${ledger.conversations} conversation(s)`)
  }
}

function printHelp() {
  console.log(`Usage: pnpm doctor -- [--json] [--redacted] [--no-checks] [--user-data <path>] [--workspace <path>]

Creates a local, redacted StudiumX diagnostic snapshot. The snapshot includes
repository hygiene, settings storage shape, diagnostic paths, and security
check results. When --workspace is provided, it also reconciles Learning Work
Ledger pointers and metadata. It does not include workspace content or log contents.`)
}
