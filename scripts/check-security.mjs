import { spawnSync } from 'node:child_process'

const checks = [
  'scripts/check-repository-hygiene.mjs',
  'scripts/check-path-access.mjs',
  'scripts/check-tool-permissions.mjs',
  'scripts/check-tool-execution.mjs',
  'scripts/check-workspace-write-tool.mjs',
  'scripts/check-web-fetch-safe-url.mjs',
  'scripts/check-external-link-controls.mjs',
  'scripts/check-app-data-migration.mjs',
  'scripts/check-provider-errors.mjs',
  'scripts/check-provider-privacy.mjs'
]

for (const check of checks) {
  console.log(`\n▶ ${check}`)
  const result = spawnSync(process.execPath, [check], { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nsecurity checks ok')
