import { runVitestRuntimeGate } from './learning-outcome-runtime-gate.mjs'

runVitestRuntimeGate({
  files: ['tests/unit/learning-outcome-committer.unit.test.ts'],
  testName: 'legacy_generated records as read-only diagnostics|durable record as repair authority'
})

console.log('learning record read-repair gate ok')
