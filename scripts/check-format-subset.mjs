#!/usr/bin/env node
/**
 * Light format subset gate (ADOPTION S-06 / ADR-0074).
 *
 * Honest scope: NO repo-wide Prettier/Biome config exists yet.
 * This gate only checks a small allowlist for:
 *   - LF line endings (no bare CR / no CRLF)
 *   - no trailing whitespace on non-empty lines
 *   - final newline at EOF
 *
 * Full Prettier (or equivalent) remains TBD; do not treat this as format coverage.
 *
 * Pure Node, no package deps.
 *   node scripts/check-format-subset.mjs
 *   pnpm run check:format
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')

/**
 * Small, intentional allowlist. Prefer CI/scripts + thin shared identity modules.
 * Expand only with files known to already satisfy the rules (avoid mega-diff).
 */
export const FORMAT_SUBSET_ALLOWLIST = Object.freeze([
  'src/shared/build-identity.ts',
  'src/shared/features.ts',
  'scripts/check-ci-results.mjs',
  'scripts/check-clean-worktree.mjs',
  'scripts/check-format-subset.mjs',
  'scripts/check-blocking-ci.mjs',
  '.github/workflows/blocking-ci.yml',
])

/**
 * @param {string} content
 * @param {string} relPath
 * @returns {string[]}
 */
export function lintFormatContent(content, relPath) {
  /** @type {string[]} */
  const issues = []

  if (content.includes('\r')) {
    issues.push(`${relPath}: contains CR / CRLF; require LF only`)
  }

  if (content.length > 0 && !content.endsWith('\n')) {
    issues.push(`${relPath}: missing final newline`)
  }

  const lines = content.split('\n')
  // If file ends with \n, last split entry is empty string — ignore trailing empty from split.
  const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length
  for (let i = 0; i < lineCount; i++) {
    const line = lines[i] ?? ''
    if (line.length > 0 && /[ \t]+$/.test(line)) {
      issues.push(`${relPath}:${i + 1}: trailing whitespace`)
    }
  }

  return issues
}

/**
 * @param {{ rootDir?: string, allowlist?: readonly string[] }} [opts]
 * @returns {Promise<{ ok: boolean, issues: string[], checked: string[] }>}
 */
export async function checkFormatSubset(opts = {}) {
  const rootDir = opts.rootDir ?? root
  const allowlist = opts.allowlist ?? FORMAT_SUBSET_ALLOWLIST
  /** @type {string[]} */
  const issues = []
  /** @type {string[]} */
  const checked = []

  for (const rel of allowlist) {
    const abs = resolve(rootDir, rel)
    let content
    try {
      content = await readFile(abs, 'utf8')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      issues.push(`${rel}: unreadable (${msg})`)
      continue
    }
    checked.push(rel)
    issues.push(...lintFormatContent(content, rel))
  }

  return { ok: issues.length === 0, issues, checked }
}

async function main() {
  const { ok, issues, checked } = await checkFormatSubset()
  console.log(
    `check-format-subset: allowlist=${checked.length} files (full prettier TBD; see ADR-0074)`,
  )
  for (const p of checked) {
    console.log(`  checked ${p}`)
  }
  if (!ok) {
    for (const issue of issues) {
      console.error(`  FAIL ${issue}`)
    }
    console.error('check-format-subset: FAILED')
    process.exit(1)
  }
  console.log('check-format-subset: OK (light LF / trailing-ws / final-newline only)')
  process.exit(0)
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('check-format-subset.mjs') ||
    process.argv[1].replaceAll('\\', '/').endsWith('scripts/check-format-subset.mjs'))

if (isDirect) {
  await main()
}
