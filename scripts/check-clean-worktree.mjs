#!/usr/bin/env node
/**
 * Clean worktree porcelain check (ADOPTION S-06 / ADR-0074).
 *
 * Fails if `git status --porcelain` reports any dirty paths.
 * Intended for Blocking CI fan-in after checkout (strict).
 *
 * Local optional skip (documented; default is strict):
 *   ALLOW_DIRTY_WORKTREE=1 node scripts/check-clean-worktree.mjs
 *
 * Pure Node + git CLI; no package deps.
 */

import { spawnSync } from 'node:child_process'
import process from 'node:process'

/**
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, gitStatus?: () => { status: number, stdout: string, stderr: string } }} [opts]
 * @returns {{ ok: boolean, message: string, porcelain: string }}
 */
export function checkCleanWorktree(opts = {}) {
  const env = opts.env ?? process.env
  if (env.ALLOW_DIRTY_WORKTREE === '1' || env.ALLOW_DIRTY_WORKTREE === 'true') {
    return {
      ok: true,
      message: 'check-clean-worktree: skipped (ALLOW_DIRTY_WORKTREE set; not for CI)',
      porcelain: '',
    }
  }

  let status = 0
  let stdout = ''
  let stderr = ''

  if (typeof opts.gitStatus === 'function') {
    const r = opts.gitStatus()
    status = r.status
    stdout = r.stdout
    stderr = r.stderr
  } else {
    const r = spawnSync('git', ['status', '--porcelain'], {
      cwd: opts.cwd ?? process.cwd(),
      encoding: 'utf8',
      env: process.env,
      windowsHide: true,
    })
    if (r.error) {
      return {
        ok: false,
        message: `check-clean-worktree: failed to run git: ${r.error.message}`,
        porcelain: '',
      }
    }
    status = r.status ?? 1
    stdout = r.stdout ?? ''
    stderr = r.stderr ?? ''
  }

  if (status !== 0) {
    return {
      ok: false,
      message: `check-clean-worktree: git status exited ${status}${stderr ? `: ${stderr.trim()}` : ''}`,
      porcelain: stdout,
    }
  }

  const porcelain = stdout.replace(/\r\n/g, '\n')
  if (porcelain.trim().length > 0) {
    return {
      ok: false,
      message: `check-clean-worktree: dirty worktree (git status --porcelain non-empty)\n${porcelain.trimEnd()}`,
      porcelain,
    }
  }

  return {
    ok: true,
    message: 'check-clean-worktree: clean (porcelain empty)',
    porcelain: '',
  }
}

function main() {
  const result = checkCleanWorktree()
  if (result.ok) {
    console.log(result.message)
    process.exit(0)
  }
  console.error(result.message)
  process.exit(1)
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('check-clean-worktree.mjs') ||
    process.argv[1].replaceAll('\\', '/').endsWith('scripts/check-clean-worktree.mjs'))

if (isDirect) {
  main()
}
