import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const selectedPlatforms = collectFlagValues(args, '--platform').concat(
  args.includes('--mac') ? ['darwin'] : [],
  args.includes('--linux') ? ['linux'] : [],
  args.includes('--win') ? ['win32'] : []
)
const selectedArchitectures = collectArchitectureFlags(args)

if (args.includes('--universal')) {
  throw new Error('C-2C packaging is host-architecture only; --universal would require separate native artifacts.')
}
for (const platform of selectedPlatforms) {
  if (platform !== process.platform) {
    throw new Error(
      `C-2C packaging is host-target only; refusing ${platform} on ${process.platform}. ` +
      'The build must not copy a stale host-native addon into a different target.'
    )
  }
}
for (const architecture of selectedArchitectures) {
  if (architecture !== process.arch) {
    throw new Error(
      `C-2C packaging is host-architecture only; refusing ${architecture} on ${process.arch}. ` +
      'The build must not copy a stale host-native addon into a different architecture.'
    )
  }
}

run('pnpm', ['run', 'build'])
run('pnpm', ['run', 'rebuild:better-sqlite3:electron'])
run('pnpm', ['exec', 'electron-builder', ...args])

function collectFlagValues(values, flag) {
  const selected = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === flag && values[index + 1]) selected.push(normalizePlatform(values[index + 1]))
    if (value.startsWith(`${flag}=`)) selected.push(normalizePlatform(value.slice(flag.length + 1)))
  }
  return selected
}

function collectArchitectureFlags(values) {
  const aliases = new Map([
    ['--x64', 'x64'],
    ['--arm64', 'arm64'],
    ['--ia32', 'ia32'],
    ['--armv7l', 'arm']
  ])
  return values.flatMap((value) => aliases.has(value) ? [aliases.get(value)] : [])
}

function normalizePlatform(value) {
  if (value === 'mac') return 'darwin'
  if (value === 'win') return 'win32'
  return value
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
