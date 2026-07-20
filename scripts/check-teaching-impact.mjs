#!/usr/bin/env node
/**
 * Path-sensitive teaching impact metadata check for PRs.
 *
 * - Without PR event / body: exits 0 with skip (unless --strict-local).
 * - With GITHUB_EVENT_PATH or --body-file / --body: enforces required fields
 *   when changed paths match sensitive prefixes.
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const strictLocal = args.includes('--strict-local')

function flagValue(name) {
  const idx = args.indexOf(name)
  if (idx === -1) return null
  return args[idx + 1] ?? null
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node scripts/check-teaching-impact.mjs [--strict-local] [--body-file path] [--body text]

When PR body is available, requires impact checkboxes/fields if sensitive paths change:
  Teaching-impact, Privacy-impact, Prompt-prefix-guard, Settlement-guard`)
  process.exit(0)
}

const SENSITIVE = [
  { field: 'Teaching-impact', patterns: [/^src\/main\/teaching-/, /^src\/shared\/teaching-/, /^src\/main\/ai\//, /^docs\/adr\/00(08|09|10|11|12|13|14|15|16|21|23)/] },
  { field: 'Privacy-impact', patterns: [/redact/i, /support-bundle/i, /secret/i, /privacy/i, /^docs\/adr\/00(07|25|34)/, /check-security/, /check-provider-privacy/] },
  { field: 'Prompt-prefix-guard', patterns: [/teaching-conversation-prompt/, /prompt-cache/, /lesson-prompts/, /skill-resource/, /0040-teaching-prompt/] },
  { field: 'Settlement-guard', patterns: [/learning-session/, /learning-outcome/, /lesson-interaction/, /teaching-turn-coordinator/, /settlement/, /docs\/adr\/00(08|10|11|18|23)/] }
]

function loadBody() {
  const bodyArg = flagValue('--body')
  if (bodyArg != null) return bodyArg
  const bodyFile = flagValue('--body-file')
  if (bodyFile && existsSync(bodyFile)) return readFileSync(bodyFile, 'utf8')
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath && existsSync(eventPath)) {
    try {
      const event = JSON.parse(readFileSync(eventPath, 'utf8'))
      return event.pull_request?.body ?? event.issue?.body ?? ''
    } catch {
      return ''
    }
  }
  return null
}

function changedPaths() {
  const base = process.env.GITHUB_BASE_REF
  if (base) {
    const r = spawnSync('git', ['diff', '--name-only', `origin/${base}...HEAD`], { cwd: root, encoding: 'utf8' })
    if (r.status === 0 && r.stdout) return r.stdout.split(/\r?\n/).filter(Boolean)
  }
  const r2 = spawnSync('git', ['diff', '--name-only', 'HEAD~1'], { cwd: root, encoding: 'utf8' })
  if (r2.status === 0 && r2.stdout) return r2.stdout.split(/\r?\n/).filter(Boolean)
  const r3 = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  if (r3.status === 0 && r3.stdout) {
    return r3.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean)
  }
  return []
}

function bodyHasField(body, field) {
  const re = new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  return re.test(body)
}

const body = loadBody()
const paths = changedPaths()

if (body == null) {
  if (strictLocal) {
    console.error('[check:teaching-impact] no PR body available under --strict-local')
    process.exit(1)
  }
  console.log('[check:teaching-impact] skip (no PR body; local non-strict)')
  process.exit(0)
}

const missing = []
for (const rule of SENSITIVE) {
  const hit = paths.some((p) => rule.patterns.some((re) => re.test(p.replace(/\\/g, '/'))))
  if (hit && !bodyHasField(body, rule.field)) missing.push(rule.field)
}

if (missing.length) {
  console.error('[check:teaching-impact] missing required PR metadata for changed sensitive paths:')
  for (const field of missing) console.error(`  - ${field}`)
  console.error('Paths considered:', paths.join(', ') || '(none)')
  process.exit(1)
}

console.log('[check:teaching-impact] ok')
process.exit(0)
