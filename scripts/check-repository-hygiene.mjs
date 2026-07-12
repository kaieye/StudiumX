import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const pkg = JSON.parse(await readFile('package.json', 'utf8'))
assert.equal(pkg.name, 'studiumx', 'root package.json should remain StudiumX metadata')
assert.equal(pkg.main, 'out/main/index.js', 'root package.json main should point at built main process')
assert.equal(pkg.build?.productName, 'StudiumX', 'Electron product name should remain StudiumX')
assert.match(pkg.packageManager ?? '', /^pnpm@11\.9\.0$/, 'package manager policy should be pinned to pnpm@11.9.0')
assert.equal(pkg.scripts?.dist, 'pnpm run build && electron-builder', 'dist script should use the pinned pnpm workflow')

assert.equal(await exists('index.js'), false, 'Codex app bundle index.js must not live in repo root')
assert.equal(await exists('desktop-CdASu-HC.js'), false, 'Codex desktop grammar chunk must not live in repo root')

const gitignore = await readFile('.gitignore', 'utf8')
assert.match(gitignore, /^ref_project\/\s*$/m, 'reference projects should stay ignored')

assert.equal(await exists('pnpm-lock.yaml'), true, 'pnpm-lock.yaml is the single committed lockfile')
assert.equal(await exists('pnpm-workspace.yaml'), true, 'pnpm workspace policy should be explicit')
assert.equal(await exists('package-lock.json'), false, 'package-lock.json should not coexist with the pnpm lockfile')

const workspace = await readFile('pnpm-workspace.yaml', 'utf8')
assert.doesNotMatch(workspace, /set this to true or false/, 'pnpm allowBuilds placeholders must be resolved')
assert.match(workspace, /'@swc\/core': true/)
assert.match(workspace, /electron-winstaller: true/)
assert.match(workspace, /esbuild: true/)

console.log('repository hygiene checks ok')
