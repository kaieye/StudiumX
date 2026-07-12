import { spawnSync } from 'node:child_process'

import { SECURITY_CHECKS } from './security-checks.mjs'

for (const check of SECURITY_CHECKS) {
  console.log(`\n▶ ${check}`)
  const result = spawnSync(process.execPath, [check], { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nsecurity checks ok')
