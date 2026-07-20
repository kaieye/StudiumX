import { runVitestRuntimeGate } from './learning-outcome-runtime-gate.mjs'
runVitestRuntimeGate({ files: ['tests/unit/learning-outcome-committer.unit.test.ts'], requiredScenarios: [
  { testName: 'reports legacy_generated records as read-only diagnostics without upgrading their bytes' },
  { testName: 'uses a durable record as repair authority after publication before projections exist' }
] })
console.log('learning record read-repair gate ok')
