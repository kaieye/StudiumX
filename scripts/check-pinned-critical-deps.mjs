#!/usr/bin/env node
/**
 * Critical dependency exact-pin check (ADR-0054 § critical npm allowlist).
 *
 * Allowlist-only: native / security-sensitive packages must use exact versions
 * in package.json (no ^ / ~ / range). Optionally verifies pnpm-lock.yaml
 * importers specifier + packages resolution match the exact pin.
 *
 * NOT part of Blocking CI / teaching gates. Optional like check:module-size.
 * Does NOT replace check:security, OSV, or Actions SHA pin.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJsonPath = path.join(root, 'package.json')
const lockPath = path.join(root, 'pnpm-lock.yaml')

/**
 * Critical packages that must be exact-pinned in package.json.
 * Keys are package names; values are optional notes for operators.
 */
const CRITICAL_ALLOWLIST = Object.freeze({
  'better-sqlite3': 'native SQLite binding (rebuild / Electron ABI sensitive)',
  '@types/better-sqlite3': 'types paired with better-sqlite3'
})

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node scripts/check-pinned-critical-deps.mjs

Checks that allowlisted critical dependencies use exact versions in package.json
(no caret ^, tilde ~, or other ranges). When pnpm-lock.yaml is present, also
checks that the importers specifier matches the package.json exact pin and that
packages resolution includes name@version for that pin.

Allowlist (ADR-0054 critical npm exact pin):
${Object.entries(CRITICAL_ALLOWLIST)
  .map(([name, note]) => `  - ${name}  # ${note}`)
  .join('\n')}

Exit codes:
  0  all allowlisted pins OK
  1  violation (range, missing dep, or lock mismatch)

Not part of Blocking CI. Does not pin UI / generic deps.
Does not replace check:security or teaching gates.

Fix example:
  "better-sqlite3": "12.11.1"   # exact — not "^12.11.1"
`)
  process.exit(0)
}

/**
 * True if the dependency version field is an exact pin (no range operators).
 * Accepts: 12.11.1, 1.2.3-beta.1
 * Rejects: ^12.11.1, ~12.11.1, >=12, 12.x, workspace:*, file:..., link:..., *
 */
function isExactVersion(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') return false
  const s = spec.trim()
  if (
    s.startsWith('^') ||
    s.startsWith('~') ||
    s.startsWith('>') ||
    s.startsWith('<') ||
    s.startsWith('=') ||
    s.includes('||') ||
    s.includes(' - ') ||
    s.includes('x') ||
    s.includes('X') ||
    s.includes('*') ||
    s.startsWith('workspace:') ||
    s.startsWith('file:') ||
    s.startsWith('link:') ||
    s.startsWith('npm:') ||
    s.startsWith('git') ||
    s.startsWith('http')
  ) {
    return false
  }
  // plain semver-ish: digits and dots, optional pre-release / build
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(s)
}

function loadPackageJson() {
  if (!existsSync(packageJsonPath)) {
    console.error(`[check:pinned-critical-deps] missing ${path.relative(root, packageJsonPath)}`)
    process.exit(1)
  }
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch (err) {
    console.error(`[check:pinned-critical-deps] failed to parse package.json: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Read direct dependency version from package.json dependencies or devDependencies.
 * @returns {{ version: string | null, section: string | null }}
 */
function findDeclaredVersion(pkg, name) {
  if (pkg.dependencies && Object.prototype.hasOwnProperty.call(pkg.dependencies, name)) {
    return { version: pkg.dependencies[name], section: 'dependencies' }
  }
  if (pkg.devDependencies && Object.prototype.hasOwnProperty.call(pkg.devDependencies, name)) {
    return { version: pkg.devDependencies[name], section: 'devDependencies' }
  }
  if (pkg.optionalDependencies && Object.prototype.hasOwnProperty.call(pkg.optionalDependencies, name)) {
    return { version: pkg.optionalDependencies[name], section: 'optionalDependencies' }
  }
  return { version: null, section: null }
}

/**
 * Parse pnpm-lock importers root specifier for a package name.
 * Looks for under importers['.'] dependencies/devDependencies style blocks:
 *   better-sqlite3:
 *     specifier: 12.11.1
 *     version: 12.11.1
 */
function readLockImporterSpec(lockText, name) {
  // Match package key then specifier line within a small window
  // Support quoted and unquoted package names
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(
      `(?:^|\\n)\\s+(?:'${escaped}'|"${escaped}"|${escaped}):\\s*\\n\\s+specifier:\\s*(\\S+)`,
      'm'
    )
  ]
  for (const re of patterns) {
    const m = lockText.match(re)
    if (m) return m[1]
  }
  return null
}

/**
 * True if packages: section lists name@exactVersion
 */
function lockHasResolvedPackage(lockText, name, exactVersion) {
  const key = `${name}@${exactVersion}`
  // packages section keys often look like:  better-sqlite3@12.11.1:
  // or quoted for scoped:  '@types/better-sqlite3@7.6.13':
  if (lockText.includes(`${key}:`)) return true
  if (lockText.includes(`'${key}':`)) return true
  if (lockText.includes(`"${key}":`)) return true
  return false
}

const pkg = loadPackageJson()
const violations = []
const notes = []

console.log('[check:pinned-critical-deps] ADR-0054 critical npm exact-pin allowlist')
console.log(
  `[check:pinned-critical-deps] allowlist: ${Object.keys(CRITICAL_ALLOWLIST).join(', ')}`
)
console.log('[check:pinned-critical-deps] mode: fail-closed on range / missing / lock mismatch')
console.log('[check:pinned-critical-deps] not Blocking CI (optional supply-chain check)')
console.log('')

let lockText = null
if (existsSync(lockPath)) {
  lockText = readFileSync(lockPath, 'utf8')
} else {
  notes.push('pnpm-lock.yaml missing — skipping lock verification')
}

for (const [name, reason] of Object.entries(CRITICAL_ALLOWLIST)) {
  const { version, section } = findDeclaredVersion(pkg, name)
  if (version == null) {
    violations.push({
      name,
      kind: 'missing',
      message: `not declared in package.json (expected under dependencies or devDependencies). reason: ${reason}`
    })
    continue
  }

  if (!isExactVersion(version)) {
    violations.push({
      name,
      kind: 'range',
      message: `${section} has "${version}" — must be exact (e.g. "12.11.1"), no ^/~ ranges. reason: ${reason}`
    })
    continue
  }

  console.log(`  OK  ${name}@${version}  (${section})`)

  if (lockText) {
    const lockSpec = readLockImporterSpec(lockText, name)
    if (lockSpec == null) {
      violations.push({
        name,
        kind: 'lock-importer',
        message: `pnpm-lock.yaml importers has no specifier for ${name}; run pnpm install after pin`
      })
    } else if (lockSpec !== version) {
      violations.push({
        name,
        kind: 'lock-importer-mismatch',
        message: `pnpm-lock.yaml importers specifier "${lockSpec}" !== package.json exact "${version}". run pnpm install`
      })
    }

    if (!lockHasResolvedPackage(lockText, name, version)) {
      violations.push({
        name,
        kind: 'lock-packages',
        message: `pnpm-lock.yaml packages missing ${name}@${version} resolution entry`
      })
    } else if (lockSpec === version) {
      console.log(`       lock importers specifier + packages ${name}@${version} match`)
    }
  }
}

console.log('')
for (const n of notes) {
  console.log(`[check:pinned-critical-deps] note: ${n}`)
}

if (violations.length > 0) {
  console.error(`[check:pinned-critical-deps] FAIL: ${violations.length} violation(s)`)
  for (const v of violations) {
    console.error(`  - ${v.name}: ${v.message}`)
  }
  console.error('')
  console.error('Fix: set allowlisted packages to exact versions in package.json, e.g.')
  console.error('  "better-sqlite3": "12.11.1"')
  console.error('  "@types/better-sqlite3": "7.6.13"')
  console.error('Then run: pnpm install')
  console.error('This check is optional (not Blocking CI) and does not replace check:security.')
  process.exit(1)
}

console.log('[check:pinned-critical-deps] ok (critical allowlist exact pins)')
process.exit(0)
