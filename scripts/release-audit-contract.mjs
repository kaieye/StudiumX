import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Explicit platform/capability skip markers.
 * Aggregate vitest "N skipped" summaries are NOT matched here; they must be
 * attributed through platformReleaseSkipBudget for the audited command+platform.
 */
export const knownPlatformSkip = /POSIX|descriptor-relative|FIFO|platform capability|win32|\[workspace write tool\].*explicitly skipped|symlink rejection|hardlink rejection|mkfifo is unavailable|filesystem does not support|case-distinct|case.sensitive/i

/**
 * Win/Mac release targets may omit coverage that requires host capabilities the
 * product models as unavailable (POSIX descriptor Memory, FIFO, symlink
 * creation under Windows privilege, native macOS/Linux-only publish paths).
 *
 * Plan §2.2 / §4: unexplained skips block release; capability-gated skips must
 * be explicit and inventoried. Exact budgets fail closed if new skips appear.
 * Update only when the new skips are documented capability gates, never to hide
 * product regressions.
 *
 * Linux CI keeps empty budgets so any aggregate vitest skip remains unknown
 * unless the line itself carries a knownPlatformSkip marker.
 */
export const platformReleaseSkipBudget = {
  win32: {
    'pnpm run test:unit': {
      testsSkipped: 69,
      filesSkipped: 3,
      rationale:
        'POSIX descriptor Memory/catalog/write suites, native macOS/Linux publish paths, FIFO, and FS case-fold capability gates (see ADR-0017 and platformReleaseSkipBudget).'
    },
    'pnpm run test:integration': {
      testsSkipped: 1,
      filesSkipped: 0,
      rationale:
        'trace-propagation concurrent Memory CRUD requires descriptor-relative Memory capability.'
    }
  },
  darwin: {
    // Seal after a clean Mac inventory; until then aggregate skips stay unknown.
  },
  linux: {
    // Full Linux release CI is expected to run without budgeted aggregate skips.
  }
}

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

export function requiresWindowsCommandShell(argv) {
  return argv[0] === 'pnpm'
}

export function auditCommandKey(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return ''
  if (argv[0] === 'pnpm' && argv[1] === 'run' && argv[2]) return `pnpm run ${argv[2]}`
  if (argv[0] === 'pnpm' && argv[1] === 'exec') return `pnpm exec ${argv[2] ?? ''}`.trim()
  if (argv[0] === 'node' && argv[1]) return `node ${argv[1]}`
  return argv.join(' ')
}

export function parseAuditSkips(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed) return []
    if (/^(?:Test Files|Tests)\b.*\b\d+\s+skipped\b/i.test(trimmed)) return [trimmed]
    if (/^\d+\s+skipped\b/i.test(trimmed)) return [trimmed]
    if (/\bexplicitly skipped\s*:/i.test(trimmed)) return [trimmed]
    if (/^(?:skip(?:ped)?|todo)$/i.test(trimmed)) return [trimmed]
    return []
  })
}

function parseVitestSkipCount(skip, kind) {
  if (kind === 'files') {
    const match = skip.match(/^Test Files\b.*?\b(\d+)\s+skipped\b/i)
    return match ? Number(match[1]) : null
  }
  if (kind === 'tests') {
    const summary = skip.match(/^Tests\b.*?\b(\d+)\s+skipped\b/i)
    if (summary) return Number(summary[1])
    const bare = skip.match(/^(\d+)\s+skipped\b/i)
    return bare ? Number(bare[1]) : null
  }
  return null
}

function isBudgetedVitestSkip(skip, platform, commandKey) {
  const budget = platformReleaseSkipBudget[platform]?.[commandKey]
  if (!budget) return false

  const filesSkipped = parseVitestSkipCount(skip, 'files')
  if (filesSkipped !== null) return filesSkipped === budget.filesSkipped

  const testsSkipped = parseVitestSkipCount(skip, 'tests')
  if (testsSkipped !== null) return testsSkipped === budget.testsSkipped

  return false
}

export function classifyAuditCommandResult(exit, skips, options = {}) {
  const platform = options.platform ?? process.platform
  const commandKey = options.commandKey ?? auditCommandKey(options.argv ?? [])
  const knownSkips = []
  const unknownSkips = []

  for (const skip of skips) {
    if (knownPlatformSkip.test(skip) || isBudgetedVitestSkip(skip, platform, commandKey)) {
      knownSkips.push(skip)
    } else {
      unknownSkips.push(skip)
    }
  }

  return {
    knownSkips,
    unknownSkips,
    // Plan §4: unexplained skips block release. Inventoried platform/capability
    // skips are classified for handoff routing and do not alone fail Win/Mac
    // release green. Product regressions and budget drift still fail closed.
    failed: exit !== 0 || unknownSkips.length > 0
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
