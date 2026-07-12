import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const tempRoot = await mkdtemp(join(tmpdir(), 'assistant-todo-check-'))
const outfile = join(tempRoot, 'assistant-todo.mjs')

try {
  await build({
    entryPoints: [join(process.cwd(), 'scripts', 'fixtures', 'assistant-todo.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  await import(pathToFileURL(outfile).href)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

const [dialog, session] = await Promise.all([
  readFile('src/renderer/src/views/pet/PetAssistantDialog.tsx', 'utf8'),
  readFile('src/renderer/src/study-space/session/useStudySession.ts', 'utf8')
])

assert.match(dialog, /appendTodoOutputContract/, 'pet dialog should request structured todo output')
assert.match(dialog, /appendAssistantTodoTasks/, 'pet dialog should import confirmed AI tasks')
assert.match(dialog, /加入今日清单/, 'pet dialog should show an explicit todo import action')
assert.match(session, /STUDY_TASKS_CHANGED_EVENT/, 'open study sessions should receive imported todo updates')

console.log('assistant todo integration checks passed')
