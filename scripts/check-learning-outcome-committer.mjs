import { runVitestRuntimeGate } from './learning-outcome-runtime-gate.mjs'
runVitestRuntimeGate({ files: ['tests/unit/learning-outcome-committer.unit.test.ts','tests/integration/learning-outcome-commit.integration.test.ts'], requiredScenarios: [
  { testName: 'publishes one evidence-gated established record and makes the operation retry idempotent' }
] })
console.log('learning outcome committer gate ok')
