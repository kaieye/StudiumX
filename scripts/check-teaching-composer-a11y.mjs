import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const shared = await readFile(resolve(root, 'src/shared/teaching-command.ts'), 'utf8')
const menu = await readFile(resolve(root, 'src/renderer/src/teaching/TeachingComposerCommandMenu.tsx'), 'utf8')
const app = await readFile(resolve(root, 'src/renderer/src/App.tsx'), 'utf8')
const reader = await readFile(resolve(root, 'src/renderer/src/views/agent-conversation/AgentConversationReader.tsx'), 'utf8')
const styles = await readFile(resolve(root, 'src/renderer/src/styles/messages.css'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/teaching-command.unit.test.ts'), 'utf8')
const packageJson = await readFile(resolve(root, 'package.json'), 'utf8')

for (const kind of ['continue', 'retry', 'show_source', 'end_session']) {
  assert.match(shared, new RegExp(`'${kind}'`), `TeachingCommand union must include ${kind}.`)
}
assert.match(shared, /export type TeachingCommandKind =/, 'Shared TeachingCommand kind union is required.')
assert.match(shared, /export function discoverTeachingCommands\(/, 'Composer discovery seam is required.')
assert.match(shared, /export function resolveTeachingCommandSubmission\(/, 'Policy-resolving submit seam is required.')
assert.match(shared, /export function parseTeachingCommandInput\(/, 'Bare command parser is required.')
assert.match(shared, /presentation_action/, 'continue/retry must stay presentation-gated.')
assert.match(shared, /FORBIDDEN_TEACHING_COMPOSER_COMMAND_TOKENS/, 'Technical tokens must be explicitly forbidden.')
for (const token of ['shell', 'mcp', 'debug', 'doctor', 'tools', 'agent']) {
  assert.match(shared, new RegExp(`'${token}'`), `Forbidden catalog must list ${token}.`)
}
assert.doesNotMatch(shared, /\b(?:writeFile|fetch|child_process|execSync|spawn)\b/, 'Teaching commands must not shell out or write files.')
assert.doesNotMatch(shared, /effectPolicy|ToolDispatcher|tool_call/, 'Teaching commands must not invoke tool dispatch or effect policy bypass helpers.')

assert.match(menu, /useTeachingComposerCommands/, 'Renderer must expose a teaching composer discovery hook.')
assert.match(menu, /role="listbox"/, 'Command menu must be keyboard/screen-reader listbox.')
assert.match(menu, /aria-label="教学命令"/, 'Command menu must have an accessible name.')
assert.doesNotMatch(menu, /shell|mcp|doctor|diagnostics/, 'Menu must not advertise technical/agent control.')

assert.match(app, /useTeachingComposerCommands/, 'Overview teaching composer must wire discovery.')
assert.match(app, /resolveTeachingCommandSubmission/, 'Overview teaching composer must resolve commands on submit.')
assert.match(app, /teachingComposer\.handleKeyDown/, 'Teaching command keyboard handling must run before free-form submit.')
assert.match(app, /不会绕过规划器|遵循当前学习流程/, 'Blocked continue/retry must explain planner gating to the learner.')
assert.match(app, /clearAgentChat\(\)/, 'end_session must stay local session control.')
assert.doesNotMatch(
  app.slice(app.indexOf('const submitCurrentMode'), app.indexOf('const answerAsk')),
  /agentChat\([^\)]*\/(?:shell|mcp|debug)/,
  'Teaching command path must not agentChat technical slash tokens.'
)

assert.match(reader, /teaching-turn-panel__your-turn/, 'Stable your-turn region class is required.')
assert.match(reader, /teaching-your-turn-\$\{presentation\.focusKey\}/, 'Your-turn region id must be stable per focusKey.')
assert.match(reader, /role=\{needsYou \? 'status' : 'note'\}/, 'Your-turn region must use status when it is the learner turn.')
assert.match(reader, /aria-live=\{needsYou \? 'polite' : 'off'\}/, 'Your-turn announcements must stay polite and gated.')
assert.match(reader, /openSourcesKey|openTeachingSourcesKey/, 'show_source must open the sources disclosure.')
assert.doesNotMatch(reader, /aria-live="assertive"/, 'Learner status must not use assertive live announcements.')

assert.match(styles, /\.teaching-turn-panel/, 'Teaching turn panel styles must exist.')
assert.match(styles, /teaching-turn-panel__your-turn/, 'Your-turn region styles must exist.')
assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*teaching-turn-panel/, 'Reduced motion must cover teaching turn chrome.')

assert.match(unit, /gates continue\/retry on presentation actions so planner cannot be bypassed/, 'Unit coverage must prove planner non-bypass.')
assert.match(unit, /never technical tokens|shell|mcp/, 'Unit coverage must prove technical commands stay out.')
assert.match(unit, /closed teaching action union/, 'Unit coverage must prove the closed union.')

assert.match(packageJson, /"check:teaching-composer-a11y"\s*:\s*"node scripts\/check-teaching-composer-a11y\.mjs"/, 'package.json must register the check script.')

console.log('teaching composer a11y gate ok')
