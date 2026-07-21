#!/usr/bin/env node
/**
 * Light import / layer gate for src/main/workspace-host/** (ADR-0078 / ADOPTION S-02).
 *
 * Fail-closed on forbidden reverse imports into agent-loop / coordinator / ledger /
 * gateway / renderer / electron. Scans source text with simple regex (no TS program).
 *
 * Optional local / optional CI only — NOT part of Blocking CI required jobs.
 *
 * Usage:
 *   node scripts/check-workspace-host-imports.mjs
 *   node scripts/check-workspace-host-imports.mjs --self-test
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = path.join(root, 'src', 'main', 'workspace-host')

/** Substrings that must not appear in import/require targets under workspace-host. */
const FORBIDDEN_PATTERNS = [
  { id: 'agent-loop', re: /agent-loop/i },
  { id: 'ai/agent-loop', re: /\/ai\/agent-loop/i },
  { id: 'teaching-turn-coordinator', re: /teaching-turn-coordinator/i },
  { id: 'learning-session-ledger', re: /learning-session-ledger/i },
  { id: 'teaching-ipc-gateway', re: /teaching-ipc-gateway/i },
  { id: 'renderer', re: /(^|\/|\\)renderer(\/|\\|$)/i },
  { id: 'electron', re: /(^|['"`])electron(['"`]|$)/i }
]

const IMPORT_LINE_RE =
  /(?:^|\n)\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|export\s+(?:type\s+)?[\s\S]*?\s+from\s+|require\s*\()\s*['"]([^'"]+)['"]/g

const args = new Set(process.argv.slice(2))

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node scripts/check-workspace-host-imports.mjs [--self-test]

Scans src/main/workspace-host/** for reverse imports into:
  agent-loop, teaching-turn-coordinator, learning-session-ledger,
  teaching-ipc-gateway, renderer, electron

Exit 0 when clean; exit 1 on violation.
Not part of Blocking CI.`)
  process.exit(0)
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

function walkSourceFiles(dir, acc = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return acc
    throw error
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkSourceFiles(full, acc)
      continue
    }
    if (!entry.isFile()) continue
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue
    if (entry.name.endsWith('.d.ts')) continue
    acc.push(full)
  }
  return acc
}

function lineNumberAt(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function scanFile(filePath) {
  const text = readFileSync(filePath, 'utf8')
  const rel = toPosix(path.relative(root, filePath))
  const violations = []

  // Collect import/require targets via global regex
  const importRe = new RegExp(IMPORT_LINE_RE.source, 'g')
  let match
  while ((match = importRe.exec(text)) !== null) {
    const target = match[1]
    const at = match.index + (match[0].startsWith('\n') ? 1 : 0)
    const line = lineNumberAt(text, at)
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.re.test(target)) {
        violations.push({
          file: rel,
          line,
          target,
          rule: rule.id
        })
      }
    }
  }

  // Also scan bare require("…") and dynamic import("…") that may not match from-form
  const bareRe = /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = bareRe.exec(text)) !== null) {
    const target = match[1]
    const line = lineNumberAt(text, match.index)
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.re.test(target)) {
        const already = violations.some(
          (v) => v.file === rel && v.line === line && v.rule === rule.id && v.target === target
        )
        if (!already) {
          violations.push({ file: rel, line, target, rule: rule.id })
        }
      }
    }
  }

  return violations
}

function scanHostTree() {
  if (!statSync(hostDir, { throwIfNoEntry: false })?.isDirectory()) {
    return {
      ok: false,
      violations: [{
        file: 'src/main/workspace-host',
        line: 0,
        target: '(missing)',
        rule: 'workspace-host-directory-missing'
      }]
    }
  }
  const files = walkSourceFiles(hostDir)
  const violations = files.flatMap((f) => scanFile(f))
  return { ok: violations.length === 0, violations, files }
}

function runSelfTest() {
  const tmp = path.join(root, '.studiumx', 'workspace-host-import-self-test')
  mkdirSync(tmp, { recursive: true })
  const badFile = path.join(tmp, 'bad-import.ts')
  writeFileSync(
    badFile,
    `import { run } from '../ai/agent-loop'\nexport const x = run\n`,
    'utf8'
  )
  try {
    const violations = scanFile(badFile)
    const hit = violations.some((v) => v.rule === 'agent-loop' || v.rule === 'ai/agent-loop')
    if (!hit) {
      console.error('self-test failed: expected forbidden agent-loop import to be detected')
      process.exit(1)
    }
    console.log('self-test ok: forbidden import detected')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (args.has('--self-test')) {
  runSelfTest()
  // Continue to real scan after self-test
}

const result = scanHostTree()
if (!result.ok) {
  console.error('check-workspace-host-imports: FAIL')
  for (const v of result.violations) {
    console.error(`  ${v.file}:${v.line}  forbidden import "${v.target}" (rule: ${v.rule})`)
  }
  console.error(`\n${result.violations.length} violation(s). See ADR-0078.`)
  process.exit(1)
}

const count = result.files?.length ?? 0
console.log(`check-workspace-host-imports: ok (${count} file(s) under src/main/workspace-host)`)
process.exit(0)
