#!/usr/bin/env node
/**
 * Module size report (ADR-0075 / AGENTS.md §5).
 *
 * Default: warning-only, always exit 0.
 * MODULE_SIZE_STRICT=1: exit 1 if any non-allowlisted file > 1000 lines.
 *
 * Not part of Blocking CI. Do not add to blocking-ci.yml required jobs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = path.join(root, 'src')

/** Soft target band upper bound (AGENTS.md §5). */
const SOFT_WARN = 800
/** High-priority / STRICT threshold. */
const HIGH_WARN = 1000

/**
 * Historical giants documented in ADR-0075.
 * Paths use forward slashes relative to repo root.
 * Allowlisted files still warn but never fail STRICT on size alone.
 */
const LEGACY_GIANTS = new Set([
  'src/main/teaching-workspace.ts',
  'src/main/learning-session-ledger.ts',
  'src/main/teaching-turn-coordinator.ts',
  'src/renderer/src/app-shell/appStore.ts',
  'src/shared/teaching-events.ts',
  'src/main/agent-conversation-session-tree.ts',
  'src/main/agent-conversation-session-audit.ts',
  'src/main/teaching-agent-conversations.ts',
  'src/renderer/src/agent-conversation-state.ts'
])

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'ref_project',
  'dist',
  'out',
  '.git',
  'coverage',
  'tests'
])

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node scripts/check-module-size.mjs

Scans src/**/*.ts (excludes *.test.ts, tests/, node_modules, ref_project).

Thresholds (physical lines, including blanks/comments):
  > ${SOFT_WARN}  soft warning
  > ${HIGH_WARN} high warning

Legacy giants (ADR-0075 allowlist) always warn only.

Exit codes:
  default              0 (warning-only)
  MODULE_SIZE_STRICT=1 1 if any non-allowlisted file > ${HIGH_WARN}

Not part of Blocking CI.`)
  process.exit(0)
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

function walkTsFiles(dir, acc = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue
      walkTsFiles(full, acc)
      continue
    }
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.ts')) continue
    if (entry.name.endsWith('.test.ts')) continue
    if (entry.name.endsWith('.d.ts')) continue
    acc.push(full)
  }
  return acc
}

function countLines(filePath) {
  const text = readFileSync(filePath, 'utf8')
  if (text.length === 0) return 0
  // Physical lines: split on \n; trailing newline still counts final empty segment
  // only if file ends with \n — match common line counters (last empty from trailing \n).
  const parts = text.split(/\r?\n/)
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    return parts.length - 1
  }
  return parts.length
}

if (!statSync(srcRoot, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('[check:module-size] src/ not found; nothing to scan')
  process.exit(0)
}

const files = walkTsFiles(srcRoot)
const rows = []
for (const full of files) {
  const rel = toPosix(path.relative(root, full))
  const lines = countLines(full)
  const legacy = LEGACY_GIANTS.has(rel)
  let level = 'ok'
  if (lines > HIGH_WARN) level = legacy ? 'legacy-giant' : 'high'
  else if (lines > SOFT_WARN) level = 'soft'
  rows.push({ rel, lines, level, legacy })
}

rows.sort((a, b) => b.lines - a.lines || a.rel.localeCompare(b.rel))

const soft = rows.filter((r) => r.level === 'soft')
const high = rows.filter((r) => r.level === 'high')
const giants = rows.filter((r) => r.level === 'legacy-giant')
const strict = process.env.MODULE_SIZE_STRICT === '1' || process.env.MODULE_SIZE_STRICT === 'true'

console.log('[check:module-size] ADR-0075 module size report')
console.log(`[check:module-size] scanned ${rows.length} production .ts files under src/`)
console.log(`[check:module-size] thresholds: soft>${SOFT_WARN} high>${HIGH_WARN} (tests excluded)`)
console.log(`[check:module-size] mode: ${strict ? 'STRICT (MODULE_SIZE_STRICT=1)' : 'warning-only (default exit 0)'}`)
console.log('')

function printSection(title, list) {
  if (list.length === 0) {
    console.log(`${title}: (none)`)
    return
  }
  console.log(`${title}: ${list.length}`)
  for (const r of list) {
    const tag = r.legacy ? ' [legacy-giant]' : ''
    console.log(`  ${String(r.lines).padStart(5)}  ${r.rel}${tag}`)
  }
  console.log('')
}

printSection(`legacy-giant (allowlisted, >${HIGH_WARN})`, giants)
printSection(`high (non-allowlisted, >${HIGH_WARN})`, high)
printSection(`soft (non-allowlisted, >${SOFT_WARN} and ≤${HIGH_WARN})`, soft)

const overSoft = soft.length + high.length + giants.length
console.log(
  `[check:module-size] summary: ${overSoft} over soft target; ${high.length} non-allowlisted high; ${giants.length} legacy-giant`
)

if (strict && high.length > 0) {
  console.error(
    `[check:module-size] STRICT fail: ${high.length} non-allowlisted file(s) exceed ${HIGH_WARN} lines`
  )
  process.exit(1)
}

console.log('[check:module-size] ok (warnings only; not Blocking CI)')
process.exit(0)
