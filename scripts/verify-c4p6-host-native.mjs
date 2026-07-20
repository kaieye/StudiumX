#!/usr/bin/env node

/**
 * Records and exercises the narrow P6 Phase-3 candidate profile.
 *
 * This is intentionally a verifier, not a durability abstraction: it fails
 * outside macOS/local APFS and only executes the approved fresh-process
 * crash/restart fixture under Electron's embedded Node runtime. It makes no
 * reboot or power-loss claim.
 */
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

if (process.platform !== 'darwin') {
  fail('P6-macOS-local-APFS-strict-candidate can only be verified on macOS.', { platform: process.platform })
}

const workspaceRoot = process.cwd()
const mountTable = await run('df', ['-P', workspaceRoot])
const mountLine = mountTable.stdout.trim().split('\n').at(-1)?.trim().split(/\s+/) ?? []
const mountPoint = mountLine.slice(5).join(' ')
if (!mountPoint) fail('Unable to determine the workspace mount point.', {})
const diskInfo = await run('diskutil', ['info', mountPoint])
const filesystem = field(diskInfo.stdout, 'File System Personality')
const deviceLocation = field(diskInfo.stdout, 'Device Location')
if (filesystem?.toLowerCase() !== 'apfs') {
  fail('Workspace is not on APFS; refusing to record P6 host-native evidence.', { filesystem: filesystem ?? null })
}
if (deviceLocation?.toLowerCase() !== 'internal') {
  fail('Workspace is not on internally attached storage; refusing the local-APFS candidate profile.', {
    deviceLocation: deviceLocation ?? null
  })
}

const electronExecutable = join(
  workspaceRoot,
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'MacOS',
  'Electron'
)
await access(electronExecutable)
const electronVersion = (await run(electronExecutable, ['--version'])).stdout.trim()
const vitestExecutable = join(workspaceRoot, 'node_modules', '.bin', 'vitest')
await access(vitestExecutable)

const profile = {
  profile: 'P6-macOS-local-APFS-strict-candidate',
  os: `${os.type()} ${os.release()}`,
  arch: process.arch,
  node: process.version,
  electron: electronVersion,
  filesystem,
  deviceLocation,
  mountPoint,
  storage: 'local/internal',
  evidence: 'fresh-process crash/restart fixture under Electron RUN_AS_NODE',
  excludes: ['Windows strict', 'network/removable storage', 'reboot durability', 'power-loss durability']
}
process.stdout.write(`${JSON.stringify(profile)}\n`)

await run(vitestExecutable, [
  'run',
  '--project',
  'integration',
  'tests/integration/learning-outcome-committer-process.integration.test.ts'
], {
  ELECTRON_RUN_AS_NODE: '1',
  STUDIUMX_P6_WORKER_EXECUTABLE: electronExecutable
})

process.stdout.write('P6 host-native crash/restart verification passed. This is not reboot or power-loss evidence.\n')

function field(output, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = output.match(new RegExp(`^\\s*${escaped}:\\s*(.+?)\\s*$`, 'm'))
  return match?.[1]
}

async function run(command, args, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: workspaceRoot,
      env: { ...process.env, ...extraEnvironment },
      maxBuffer: 4 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error([
          `Command failed: ${command} ${args.join(' ')}`,
          error.message,
          `stdout:\n${stdout}`,
          `stderr:\n${stderr}`
        ].join('\n')))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function fail(message, context) {
  process.stderr.write(`${message}\n${JSON.stringify(context)}\n`)
  process.exitCode = 1
  throw new Error(message)
}
