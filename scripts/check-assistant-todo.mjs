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

const [dialog, session, localeZh, assistantTodo] = await Promise.all([
  readFile('src/renderer/src/views/pet/PetAssistantDialog.tsx', 'utf8'),
  readFile('src/renderer/src/study-space/session/useStudySession.ts', 'utf8'),
  readFile('src/renderer/src/i18n/locales/zh-CN.json', 'utf8'),
  readFile('src/renderer/src/study-space/assistantTodo.ts', 'utf8')
])

assert.match(dialog, /AssistantTodoCapture\.preparePrompt/, 'pet dialog should request structured todo output')
assert.match(dialog, /AssistantTodoCapture\.importTasks/, 'pet dialog should import confirmed AI tasks')
assert.match(dialog, /resources\.pets\.assistant\.actions\.addTodo/, 'pet dialog should surface an explicit todo import action')
assert.match(localeZh, /加入今日清单/, 'the todo import action label must be localized')
assert.match(assistantTodo, /appendTodoOutputContract/, 'assistant todo module keeps the structured output contract')
assert.match(assistantTodo, /appendAssistantTodoTasks/, 'assistant todo module keeps the confirmed-task import path')
assert.match(session, /STUDY_TASKS_CHANGED_EVENT/, 'open study sessions should receive imported todo updates')

console.log('assistant todo integration checks passed')
