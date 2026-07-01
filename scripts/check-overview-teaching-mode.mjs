import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('src/renderer/src/App.tsx', 'utf8')

assert.match(
  app,
  /\{view === 'overview' && \(\s*<OverviewChat active=\{active\} \/>\s*\)\}/s,
  'overview teaching/chat surface should render the agent chat flow instead of a local lesson clarification flow'
)

assert.match(
  app,
  /const isTeachingMode = view !== 'agent' && overviewDialogMode === 'teaching'/,
  'OverviewChat should know when the switch is in teaching mode'
)

assert.match(
  app,
  /submitTeachingPrompt\(inputValue\)/,
  'teaching-mode submit should send the teaching input through lesson generation'
)

assert.match(
  app,
  /settings\.generator\.streaming \? generateLessonStream\(\) : generateLesson\(\)/,
  'teaching-mode submit should route through the configured lesson generator'
)

assert.doesNotMatch(
  app,
  /agentChat\(isTeachingMode \? inputValue : undefined\)/,
  'teaching-mode submit must not route concept learning requests through agent chat'
)

assert.doesNotMatch(
  app,
  /generateLesson(?:Stream)?\([\s\S]*messages:\s*get\(\)\.agentTurns/,
  'lesson generation must not inject temporary chat history into course design'
)

assert.match(
  app,
  /const conversations = \(workspace\?\.conversations \?\? \[\]\)\.filter\(isTemporaryConversation\)/,
  'root conversation sidebar should only show temporary conversations'
)

assert.doesNotMatch(
  app,
  /appendClarificationTurns/,
  'renderer must not append local TeachingClarificationResult.assistantMessage as an assistant reply'
)

assert.doesNotMatch(
  app,
  /overviewDialogMode:\s*'chat',\s*\n\s*lessonReaderOpen:\s*false,\s*\n\s*(?:selectedCoursePreviewFile:\s*null,\s*\n\s*)?appState:\s*[^,\n]+,\s*\n\s*agentTurns:/,
  'generation clarification fallback must not force the overview switch to chat mode'
)

console.log('overview teaching mode routing ok')
