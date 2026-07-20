import { runVitestRuntimeGate } from './learning-outcome-runtime-gate.mjs'
runVitestRuntimeGate({ files: ['tests/unit/learning-outcome-committer.unit.test.ts'], requiredScenarios: [
  { testName: 'deterministically repairs an after-outcome-publication crash after restart without reevaluation or outcome rewrite' },
  { testName: 'uses a durable record as repair authority after publication before projections exist' }
] })
console.log('learning outcome recovery gate ok')
