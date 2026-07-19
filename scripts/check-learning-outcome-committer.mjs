import { runVitestRuntimeGate } from './learning-outcome-runtime-gate.mjs'

runVitestRuntimeGate({
  files: [
    'tests/unit/learning-outcome-committer.unit.test.ts',
    'tests/integration/learning-outcome-commit.integration.test.ts'
  ]
})

console.log('learning outcome committer gate ok')
