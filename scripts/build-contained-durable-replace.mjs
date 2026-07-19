import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const requestedPlatform = process.env.npm_config_platform
const requestedArch = process.env.npm_config_arch

if (requestedPlatform && requestedPlatform !== process.platform) {
  throw new Error(
    `contained-durable-replace is host-built only; refusing ${requestedPlatform} artifact on ${process.platform}. ` +
    'Do not package a stale host-native addon for a different target.'
  )
}
if (requestedArch && requestedArch !== process.arch) {
  throw new Error(
    `contained-durable-replace is host-built only; refusing ${requestedArch} artifact on ${process.arch}. ` +
    'Do not package a stale host-native addon for a different architecture.'
  )
}

const nodeGyp = join(projectRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
if (!existsSync(nodeGyp)) {
  throw new Error('node-gyp is not installed. Run pnpm install before building the optional C-2C native capability.')
}
execFileSync(process.execPath, [nodeGyp, 'rebuild', '--directory', 'native/contained-durable-replace'], {
  cwd: projectRoot,
  stdio: 'inherit'
})
