#!/usr/bin/env node
import { resolve } from 'node:path'

import { mergeLearningWorkLedgerToLegacyActive } from './lib/learning-work-reconcile.mjs'

const [rootPath] = process.argv.slice(2).filter((argument) => argument !== '--')
if (!rootPath || rootPath === '--help' || rootPath === '-h') {
  console.error('Usage: node scripts/merge-learning-work-legacy.mjs <workspace-root>')
  console.error('Creates a checksum-verified, atomic legacy active learning-work.jsonl export without deleting sealed segments.')
  process.exitCode = rootPath ? 0 : 2
} else {
  try {
    const result = await mergeLearningWorkLedgerToLegacyActive(resolve(rootPath))
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
