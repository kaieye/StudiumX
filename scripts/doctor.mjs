#!/usr/bin/env node
import { SECURITY_CHECKS } from './security-checks.mjs'
import {
  calculateDoctorExitCode,
  collectDoctorSnapshot,
  defaultDoctorUserDataPath,
  formatDoctorReport,
  redactDoctorSnapshot
} from './lib/doctor-snapshot.mjs'

const args = process.argv.slice(2)
const argSet = new Set(args)

if (argSet.has('--help') || argSet.has('-h')) {
  printHelp()
  process.exit(0)
}

const snapshot = await collectDoctorSnapshot({
  cwd: process.cwd(),
  userDataPath: valueForArg('--user-data') ?? process.env.STUDIUMX_USER_DATA ?? defaultDoctorUserDataPath(),
  workspacePath: valueForArg('--workspace'),
  runChecks: !argSet.has('--no-checks'),
  checkCatalog: SECURITY_CHECKS
})
const report = argSet.has('--no-redacted') ? snapshot : redactDoctorSnapshot(snapshot)

process.stdout.write(formatDoctorReport(report, argSet.has('--json') ? 'json' : 'text'))
process.exitCode = calculateDoctorExitCode(snapshot)

function valueForArg(name) {
  const equalsPrefix = `${name}=`
  const inline = args.find((arg) => arg.startsWith(equalsPrefix))
  if (inline) return inline.slice(equalsPrefix.length)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

function printHelp() {
  console.log(`Usage: pnpm doctor -- [--json] [--redacted] [--no-checks] [--user-data <path>] [--workspace <path>]

Creates a local, redacted StudiumX diagnostic snapshot. The snapshot includes
repository hygiene, settings storage shape, diagnostic paths, and security
check results. When --workspace is provided, it also reconciles Learning Work
Ledger pointers and metadata. It does not include workspace content or log contents.`)
}
