import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export const knownPlatformSkip = /POSIX|descriptor-relative|FIFO|platform capability|win32/i

export const releaseAuditCommands = [
  ['pnpm', 'install', '--frozen-lockfile'],
  ['pnpm', 'run', 'typecheck'],
  ['pnpm', 'run', 'test:unit'],
  ['pnpm', 'run', 'test:integration'],
  ['pnpm', 'run', 'build'],
  ['pnpm', 'run', 'check:security'],
  ['pnpm', 'run', 'check:provider-privacy'],
  ['pnpm', 'run', 'check:repository-hygiene'],
  ['pnpm', 'run', 'check:settings-secret-storage'],
  ['pnpm', 'run', 'check:agent-run-recovery'],
  ['pnpm', 'run', 'check:agent-operation-idempotency'],
  ['pnpm', 'run', 'check:workspace-write-tool'],
  ['pnpm', 'run', 'check:web-fetch-safe-url'],
  ['pnpm', 'run', 'check:external-link-controls'],
  ['node', 'scripts/check-learning-outcome-committer.mjs'],
  ['node', 'scripts/check-learning-outcome-recovery.mjs'],
  ['node', 'scripts/check-learning-record-read-repair.mjs'],
  ['node', 'scripts/check-workspace-catalog-reconciliation.mjs'],
  ['pnpm', 'run', 'check:teaching-learning-loop'],
  ['pnpm', 'exec', 'playwright', 'test', 'tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts', '--project=electron-e2e', '--repeat-each=3'],
  ['pnpm', 'exec', 'playwright', 'test', 'tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts', '--project=electron-e2e', '--repeat-each=3'],
  ['pnpm', 'exec', 'playwright', 'test', 'tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts', '--project=electron-e2e', '--repeat-each=3'],
  ['git', 'diff', '--check'],
  ['git', 'status', '--porcelain=v1']
]

export function parseAuditSkips(output) {
  return [...output.matchAll(/(?:skip(?:ped)?|todo)[:\-]?\s*([^\n]+)/gi)].map((match) => match[1].trim())
}

export function classifyAuditCommandResult(exit, skips) {
  const knownSkips = skips.filter((skip) => knownPlatformSkip.test(skip))
  const unknownSkips = skips.filter((skip) => !knownPlatformSkip.test(skip))
  return {
    knownSkips,
    unknownSkips,
    // A release proof cannot be green with any omitted coverage. Known platform skips
    // remain classified so the handoff can route them to a supported platform.
    failed: exit !== 0 || skips.length > 0
  }
}

function resolvePhysicalPath(path) {
  let existingAncestor = resolve(path)
  const missingSegments = []

  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor)
    if (parent === existingAncestor) return resolve(path)
    missingSegments.unshift(basename(existingAncestor))
    existingAncestor = parent
  }

  try {
    return resolve(realpathSync.native(existingAncestor), ...missingSegments)
  } catch {
    return resolve(path)
  }
}

export function isPathInside(parentPath, candidatePath) {
  const pathFromParent = relative(resolvePhysicalPath(parentPath), resolvePhysicalPath(candidatePath))
  return pathFromParent === '' || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent))
}

export function isCleanCheckoutStatusCommand(argv) {
  return argv.length === 3 && argv[0] === 'git' && argv[1] === 'status' && argv[2] === '--porcelain=v1'
}
