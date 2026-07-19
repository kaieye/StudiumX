import { runVitestRuntimeGate } from './learning-outcome-runtime-gate.mjs'

runVitestRuntimeGate({
  files: ['tests/unit/learning-outcome-committer.unit.test.ts'],
  testName: 'durable record as repair authority|after-outcome-publication crash|reconciliation_required|already_committed'
})

console.log('learning outcome recovery gate ok')
