import type { LearningOutcomeCommitterFaultPoint } from '../learning-outcome-committer'

const E2E_CRASH_POINTS: readonly LearningOutcomeCommitterFaultPoint[] = [
  'after_stage_flush',
  'before_catalog_reconcile',
  'after_record_publish',
  'after_outcome_publish'
]

/** Returns a crash seam only for explicitly marked Electron E2E test runtimes. */
export function resolveE2ECrashPoint(env: NodeJS.ProcessEnv): LearningOutcomeCommitterFaultPoint | undefined {
  if (env.NODE_ENV !== 'test' || env.STUDIUMX_TEST !== '1' || env.STUDIUMX_E2E !== '1') return undefined
  const candidate = env.STUDIUMX_E2E_CRASH_POINT
  return E2E_CRASH_POINTS.includes(candidate as LearningOutcomeCommitterFaultPoint)
    ? candidate as LearningOutcomeCommitterFaultPoint
    : undefined
}

/** Only the first evidence revision is exempted so correction (outcome-seq-2) still crashes. */
export function isInitialCatalogReconcileOperation(point: LearningOutcomeCommitterFaultPoint, operationId: string): boolean {
  return point === 'before_catalog_reconcile' && operationId === 'outcome-seq-1'
}

/**
 * Constructs a destructive durability-fault hook only in an explicitly marked
 * Electron E2E runtime. It is unavailable to normal application execution.
 */
export function createE2ECrashFaults(env: NodeJS.ProcessEnv): {
  inject(point: LearningOutcomeCommitterFaultPoint, context: { sessionId: string; operationId: string }): Promise<void>
} | undefined {
  const crashPoint = resolveE2ECrashPoint(env)
  if (!crashPoint) return undefined

  return {
    async inject(point, context): Promise<void> {
      if (point !== crashPoint || isInitialCatalogReconcileOperation(point, context.operationId)) return
      await terminateE2ERuntimeForCrash()
    }
  }
}

/**
 * Terminates the entire Electron runtime for a deliberately injected E2E crash.
 * Electron's Windows app process is a child of Playwright's launch process, so
 * the observed launcher (process.ppid) must be the tree root.
 */
function terminateE2ERuntimeForCrash(): Promise<never> {
  if (process.platform !== 'win32') {
    process.kill(process.pid, 'SIGKILL')
  } else {
    const rootPid = process.ppid > 0 ? process.ppid : process.pid
    void import('node:child_process').then(({ execFile }) => {
      execFile('taskkill', ['/PID', String(rootPid), '/T', '/F'], { windowsHide: true }, () => undefined)
    })
  }

  // Never permit a normal commit result while the asynchronous Windows process
  // tree terminator is being scheduled.
  return new Promise<never>(() => undefined)
}
