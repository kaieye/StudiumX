import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('src/renderer/src/App.tsx', 'utf8')

assert.doesNotMatch(
  app,
  /我想先学习如何把 teach 技能包的 MISSION、RESOURCES 和 lessons 组织成一个 Electron 桌面应用的 MVP/,
  'overview composer should not prefill the old TeachOS MVP learning prompt'
)

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
  /setOverviewDialogMode\('teaching'\)[\s\S]*clearAgentChat\(\)/,
  'new conversation navigation should open the overview composer in teaching mode'
)

assert.match(
  app,
  /selectCourseFolder:[\s\S]*overviewDialogMode:\s*'teaching'/,
  'opening a course folder should switch the composer back to teaching mode'
)

assert.match(
  app,
  /const hasCourseContent = selectedCourseRelativePath[\s\S]*selectedCourse\.sessionCount > 0[\s\S]*view: hasCourseContent \? 'lessons' : 'overview'/,
  'empty course folders should open the teaching dialog instead of the empty lesson library'
)

assert.match(
  app,
  /const handleOpen = async \(\): Promise<void> => \{\s*if \(treeRoot === 'courses'\) \{\s*setOverviewDialogMode\('teaching'\)/,
  'opening any row in the course tree should switch the composer back to teaching mode'
)

assert.match(
  app,
  /openWorkspaceTeachingMode:[\s\S]*view:\s*'overview'[\s\S]*overviewDialogMode:\s*'teaching'/,
  'opening a workspace folder should enter the overview teaching dialog, not stay in chat mode'
)

assert.match(
  app,
  /if \(isWorkspaceFolder\) \{\s*await onEnsureWorkspaceSelected\(\)\s*openWorkspaceTeachingMode\(\)/,
  'clicking the imported workspace root folder should activate teaching mode before toggling the folder'
)

assert.match(
  app,
  /loadCourseHtmlFile: async \(file\) => \{[\s\S]*overviewDialogMode:\s*'teaching'/,
  'opening a course HTML file should keep the composer in teaching mode'
)

assert.match(
  app,
  /const continueTeachingConversation = isTeachingMode && Boolean/,
  'teaching-mode composer should detect when the visible chat is an existing teaching conversation'
)

assert.match(
  app,
  /if \(continueTeachingConversation\) \{\s*void agentChat\(prompt, \{ mode: 'teaching' \}\)\s*return\s*\}/,
  'teaching-mode follow-up answers should continue the teaching conversation before any lesson generation'
)

assert.match(
  app,
  /submitTeachingPrompt\(inputValue\)/,
  'teaching-mode submit should keep using the teaching submit handler'
)

assert.match(
  app,
  /void \(settings\.generator\.streaming \? generateLessonStream\(\) : generateLesson\(\)\)/,
  'new teaching prompts without an active teaching conversation should still route through the configured lesson generator'
)

assert.match(
  app,
  /const lessonMessages = activeTeachingConversationSummary\(/,
  'lesson generation should derive context only from an active teaching conversation'
)

assert.match(
  app,
  /messages: lessonMessages/,
  'lesson generation should send active teaching conversation history to the generator'
)

assert.doesNotMatch(
  app,
  /agentChat\(isTeachingMode \? inputValue : undefined\)/,
  'teaching-mode submit must not indiscriminately route every concept learning request through temporary agent chat'
)

assert.doesNotMatch(
  app,
  /messages:\s*get\(\)\.agentTurns/,
  'lesson generation must not inject raw or temporary chat history into course design'
)

assert.match(
  app,
  /<SidebarConversationSection[\s\S]*conversations=\{appState\.temporaryConversations\}/,
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
