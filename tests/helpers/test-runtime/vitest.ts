import { afterEach } from 'vitest'
import { createTestRuntime, type TestRuntime } from '../test-runtime'

export interface VitestRuntimeScope {
  create(label?: string): Promise<TestRuntime>
}

export function createVitestRuntimeScope(): VitestRuntimeScope {
  const runtimes: TestRuntime[] = []

  afterEach(async () => {
    const cleanupResults = await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.cleanup()))
    const failures = cleanupResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length > 0) {
      throw new AggregateError(failures.map((failure) => failure.reason), 'Unable to clean up test runtimes.')
    }
  })

  return {
    create: async (label = 'vitest') => {
      const runtime = await createTestRuntime(label)
      runtimes.push(runtime)
      return runtime
    }
  }
}