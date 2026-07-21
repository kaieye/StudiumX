import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const effectSource = await readFile(resolve(root, 'src/main/ai/tools/effect-policy.ts'), 'utf8')
const contract = await readFile(resolve(root, 'docs/tools/TOOL_CONTRACT.md'), 'utf8')
const registrySources = await Promise.all([
  'src/main/ai/tools/ask.ts',
  'src/main/ai/tools/delegation.ts',
  'src/main/ai/tools/skill-resource.ts',
  'src/main/ai/tools/workspace.ts',
  'src/main/ai/tools/memory-tools.ts',
  'src/main/ai/tools/web_fetch.ts',
  'src/main/ai/tools/web_search.ts',
  'src/main/teaching-conversation-lesson-tool.ts'
].map((file) => readFile(resolve(root, file), 'utf8')))

const effectNames = new Map()
for (const match of effectSource.matchAll(/const (WORKSPACE_READ_TOOLS|WORKSPACE_WRITE_TOOLS|EXTERNAL_WRITE_TOOLS|PRIVILEGED_TOOLS) = new Set\(\[([\s\S]*?)\]\)/g)) {
  const effectClass = ({ WORKSPACE_READ_TOOLS: 'read', WORKSPACE_WRITE_TOOLS: 'workspace_write', EXTERNAL_WRITE_TOOLS: 'external_write', PRIVILEGED_TOOLS: 'privileged' })[match[1]]
  for (const name of match[2].matchAll(/'([^']+)'/g)) effectNames.set(name[1], effectClass)
}
assert.ok(effectNames.size > 0, 'effect-policy catalog is empty or changed shape')

const registeredNames = new Set()
for (const source of registrySources) {
  for (const match of source.matchAll(/(?:name|function:\s*\{\s*name):\s*'([^']+)'(?:\s*\|\s*'([^']+)')?/g)) {
    registeredNames.add(match[1])
    if (match[2]) registeredNames.add(match[2])
  }
}
for (const name of effectNames.keys()) assert.ok(registeredNames.has(name), `effect-policy tool ${name} is not present in registry sources`)
for (const name of registeredNames) assert.ok(effectNames.has(name), `registered tool ${name} has no explicit effect-policy mapping`)

const rows = new Map()
for (const match of contract.matchAll(/^\| `([^`]+)` \| `([^`]+)` \|/gm)) rows.set(match[1], match[2])
assert.deepEqual([...rows.keys()].sort(), [...registeredNames].sort(), 'TOOL_CONTRACT.md tool rows drift from registry')
for (const [name, effectClass] of effectNames) assert.equal(rows.get(name), effectClass, `contract effectClass drift for ${name}`)
assert.match(contract, /需批准/)
assert.match(contract, /按风险/)
assert.match(contract, /本课放行/)
assert.match(contract, /Do not expose or label a mode as .*YOLO/)
console.log(`tool contract ok (${registeredNames.size} tools)`)
