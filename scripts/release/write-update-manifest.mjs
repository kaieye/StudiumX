import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [platform, releaseDirectory = 'release'] = process.argv.slice(2)
const root = resolve(releaseDirectory)
const version = JSON.parse(readFileSync('package.json', 'utf8')).version

const manifests = {
  win: {
    output: 'latest.yml',
    filePattern: new RegExp(`^StudiumX-${escapeRegExp(version)}-win-x64\\.exe$`),
    path: (files) => files[0],
  },
  linux: {
    output: 'latest-linux.yml',
    filePattern: new RegExp(`^StudiumX-${escapeRegExp(version)}-linux-x86_64\\.AppImage$`),
    path: (files) => files[0],
  },
  mac: {
    output: 'latest-mac.yml',
    filePattern: new RegExp(`^StudiumX-${escapeRegExp(version)}-mac-arm64\\.(zip|dmg)$`),
    path: (files) => files.find((file) => file.endsWith('.zip')),
  },
}

const definition = manifests[platform]
if (!definition) {
  throw new Error(`Unsupported platform ${JSON.stringify(platform)}; expected win, linux, or mac.`)
}
if (!existsSync(root)) {
  throw new Error(`Release directory does not exist: ${root}`)
}

const files = readdirSync(root)
  .filter((file) => definition.filePattern.test(file))
  .sort((left, right) => left.localeCompare(right))

const expectedFileCount = platform === 'mac' ? 2 : 1
if (files.length !== expectedFileCount) {
  throw new Error(
    `Expected ${expectedFileCount} ${platform} installer file(s) for version ${version} in ${root}, found: ${files.join(', ') || '(none)'}`
  )
}

const entries = files.map((file) => ({
  url: file,
  sha512: sha512(join(root, file)),
  size: statSync(join(root, file)).size,
}))
const primaryFile = typeof definition.path === 'function' ? definition.path(files) : definition.path
const primary = entries.find((entry) => entry.url === primaryFile)
if (!primary) throw new Error(`Unable to determine primary update file for ${platform}.`)

const content = [
  `version: ${version}`,
  'files:',
  ...entries.flatMap((entry) => [
    `  - url: ${entry.url}`,
    `    sha512: ${entry.sha512}`,
    `    size: ${entry.size}`,
  ]),
  `path: ${primary.url}`,
  `sha512: ${primary.sha512}`,
].join('\n') + '\n'

writeFileSync(join(root, definition.output), content)

function sha512(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
