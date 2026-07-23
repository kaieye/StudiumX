import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, workbench, leaderboard, roomSwitcher, pomodoro, tasks, viewModel, css, leaderboardPillCss] = await Promise.all([
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchLeaderboard.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchRoomSwitcher.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchPomodoro.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchTasks.tsx', 'utf8'),
  readFile('src/renderer/src/study-space/viewModel.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench.css', 'utf8'),
  readFile('src/renderer/src/views/workbench/workbench-leaderboard-pill.css', 'utf8')
])

assert.match(
  workbench,
  /<WorkbenchLeaderboard[\s\S]*members=\{viewModel\.roomMembers\}[\s\S]*presenceStatus=\{presence\.status\}[\s\S]*spaceCode=\{snapshot\.spaceCode\}[\s\S]*onEnterRandomSpace=\{enterRandomSpace\}[\s\S]*onJoinSpace=\{joinSpace\}[\s\S]*\/>/,
  'workbench should render the leaderboard with live room data and room switching callbacks'
)

assert.doesNotMatch(
  workbench,
  /<div className="workbench-tools"[\s\S]*<WorkbenchRoomSwitcher/,
  'room switching controls should no longer render in the right-side tools rail'
)

assert.equal(
  [...leaderboard.matchAll(/<button\b/g)].length,
  1,
  'collapsed leaderboard entry should use exactly one button before its conditional panel'
)

assert.match(
  leaderboard,
  /const selfRank = Math\.max\(1, members\.findIndex\(\(member\) => member\.isSelf\) \+ 1\)/,
  'leaderboard button should derive the current user rank from the sorted member list'
)

assert.match(
  leaderboard,
  /<strong>#\{selfRank\}\/\{totalMembers\}<\/strong>/,
  'leaderboard button should show rank and current member count as #rank/total'
)

assert.doesNotMatch(
  leaderboard,
  /studySignalShortLabel|<small>|<span>#\{index \+ 1\}<\/span>| · 我/,
  'leaderboard rows should only render each member name and focused time'
)
assert.match(
  leaderboard,
  /members\.map\(\(member\) => \([\s\S]*workbench-leaderboard-row[\s\S]*<strong>\{member\.nickname\}<\/strong>[\s\S]*<em>\{formatStudyHours\(member\.todayFocusSeconds\)\}h<\/em>/,
  'each leaderboard row should contain only the member name and focused time'
)

assert.match(
  leaderboard,
  /workbench-leaderboard-title[\s\S]*workbench-heartbeat-dot[\s\S]*workbench-leaderboard-space-code[^>]*>\{spaceCode\}<\/code>/,
  'leaderboard header should show the title, heartbeat, then room code'
)

assert.doesNotMatch(
  roomSwitcher,
  /spaceCode=\{|<Copy|复制/,
  'leaderboard room actions should not duplicate the room code or the old copy control'
)

assert.doesNotMatch(
  pomodoro,
  /25\/5|50\/10|90\/15|workbench-pomodoro-presets/,
  'pomodoro card should not render preset duration buttons'
)

assert.match(
  pomodoro,
  /useWorkbenchDisclosureReveal\(\)[\s\S]*aria-expanded=\{open\}[\s\S]*aria-controls="workbench-pomodoro-panel"/,
  'pomodoro should expose an accessible collapsed toggle'
)
assert.match(
  pomodoro,
  /workbench-disclosure-reveal[\s\S]*aria-hidden=\{!open\}[\s\S]*inert=\{!open\}[\s\S]*id="workbench-pomodoro-panel"[\s\S]*workbench-pomodoro-actions/,
  'pomodoro controls should stay mounted and inert while the detail panel is closed'
)
assert.match(
  pomodoro,
  /workbench-pomodoro-toggle-label[\s\S]*<Timer[\s\S]*\{timerLabel\}[\s\S]*workbench-pomodoro-toggle-meta[\s\S]*\{remainingTime\}/,
  'collapsed pomodoro should keep the current mode and remaining time visible'
)


assert.match(
  tasks,
  /useWorkbenchDisclosureReveal\(\)[\s\S]*aria-expanded=\{open\}[\s\S]*aria-controls="workbench-task-panel"/,
  'task list should expose an accessible collapsed toggle'
)
assert.match(
  tasks,
  /workbench-disclosure-reveal[\s\S]*aria-hidden=\{!open\}[\s\S]*inert=\{!open\}[\s\S]*id="workbench-task-panel"[\s\S]*workbench-task-list[\s\S]*workbench-task-toggle-card/,
  'task list controls should stay mounted and inert while the detail panel is closed'
)
assert.match(
  tasks,
  /workbench-task-toggle-label[\s\S]*今日清单[\s\S]*workbench-task-toggle-meta[\s\S]*\{openTasks\} 待办/,
  'collapsed task list should keep the pending task count visible'
)

for (const [name, source] of [
  ['pomodoro', pomodoro],
  ['task list', tasks]
]) {
  assert.match(
    source,
    /workbench-disclosure-card[\s\S]*workbench-disclosure-toggle[\s\S]*workbench-disclosure-(?:label|meta)/,
    `${name} should use the shared disclosure-card UI and click contract`
  )
}

assert.match(
  leaderboard,
  /aria-expanded=\{open\}[\s\S]*workbench-leaderboard-reveal[\s\S]*aria-hidden=\{!open\}[\s\S]*inert=\{!open\}[\s\S]*<WorkbenchRoomSwitcher[\s\S]*onEnterRandomSpace=\{onEnterRandomSpace\}[\s\S]*onJoinSpace=\{onJoinSpace\}/,
  'leaderboard content should stay mounted but inert so opening and closing can animate accessibly'
)
assert.match(
  leaderboard,
  /const \[isClosing, setIsClosing\] = useState\(false\)[\s\S]*collapseTimerRef[\s\S]*setIsClosing\(true\)[\s\S]*window\.setTimeout[\s\S]*setIsClosing\(false\)/,
  'leaderboard should retain its expanded geometry while the content collapses'
)
assert.match(
  leaderboard,
  /workbench-leaderboard\$\{open \? ' is-open' : ''\}\$\{isClosing \? ' is-closing' : ''\}/,
  'leaderboard should expose a closing class for the collapse animation phase'
)

assert.match(
  roomSwitcher,
  /workbench-leaderboard-actions[\s\S]*<form className="workbench-room-join"[\s\S]*aria-label="加入房间"[\s\S]*<CornerDownLeft[\s\S]*workbench-room-random[\s\S]*aria-label="随机进入自习室"/,
  'expanded leaderboard footer should render the enter-key join action before the icon-only random action'
)

assert.match(css, /\.workbench-tools \.workbench-leaderboard-toggle \{/, 'workbench leaderboard button should have dedicated styling')
assert.match(
  leaderboardPillCss,
  /\.office-workbench-stage > \.workbench-leaderboard \{[\s\S]*width: min\([\s\S]*292px,[\s\S]*border-radius: 999px;/,
  'collapsed leaderboard should use a fixed-width pill shape'
)
assert.match(
  leaderboardPillCss,
  /\.office-workbench-stage > \.workbench-leaderboard\.is-open \{[\s\S]*width: min\([\s\S]*292px,[\s\S]*border-radius: 24px;/,
  'expanded leaderboard should preserve its width and only soften the outer corners'
)
assert.doesNotMatch(
  leaderboardPillCss,
  /width: min\(\s*430px|max-width: min\(\s*430px|transition:[^}]*\bwidth\b/,
  'leaderboard should not grow toward the right when expanded'
)
assert.doesNotMatch(
  leaderboardPillCss,
  /\.office-workbench-stage > \.workbench-leaderboard \{[^}]*transition:[^}]*border-radius/,
  'leaderboard corner geometry should switch immediately instead of animating the pill arc during reveal'
)
assert.doesNotMatch(
  css,
  /\.office-workbench-stage > \.workbench-leaderboard \{[^}]*transition:[^}]*border-radius/,
  'the final workbench stylesheet should not restore the problematic rounded-corner transition'
)
assert.match(
  leaderboardPillCss,
  /\.office-workbench-stage > \.workbench-leaderboard\.is-closing \{[^}]*border-radius: 24px;/,
  'closing leaderboard should keep compact panel corners while its detail area animates away'
)
assert.match(
  leaderboardPillCss,
  /\.workbench-leaderboard-reveal \{[\s\S]*height 300ms cubic-bezier\(0\.65, 0, 0\.35, 1\)[\s\S]*opacity 300ms cubic-bezier\(0\.65, 0, 0\.35, 1\)/,
  'leaderboard should use the same symmetric 300ms height and opacity motion for opening and closing'
)
assert.match(
  leaderboardPillCss,
  /\.workbench-leaderboard\.is-open \.workbench-leaderboard-reveal \{[\s\S]*height 300ms cubic-bezier\(0\.65, 0, 0\.35, 1\)[\s\S]*opacity 300ms cubic-bezier\(0\.65, 0, 0\.35, 1\)/,
  'expanded leaderboard should use the same height motion curve as the collapse'
)
assert.match(
  leaderboardPillCss,
  /\.office-workbench-stage > \.workbench-leaderboard \.workbench-leaderboard-toggle,[\s\S]*?\.workbench-leaderboard-toggle:active \{[\s\S]*?transform: none;[\s\S]*?filter: none;[\s\S]*?transition: none;/,
  'leaderboard toggle should explicitly disable all pressed text feedback'
)
assert.match(
  leaderboard,
  /const LEADERBOARD_REVEAL_DURATION_MS = 300[\s\S]*?window\.setTimeout\([\s\S]*?LEADERBOARD_REVEAL_DURATION_MS\)/,
  'the closing geometry delay should exactly match the 300ms reveal motion'
)
assert.doesNotMatch(
  leaderboardPillCss,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?(?:workbench-leaderboard-reveal|workbench-leaderboard-panel)[\s\S]*?transition-duration: 1ms/,
  'a host reduced-motion preference must not collapse the leaderboard detail animation to 1ms'
)
assert.match(
  css,
  /\.office-workbench-stage > \.workbench-leaderboard\.is-open \{[^}]*width: min\(292px,[^}]*max-width: min\(292px,[^}]*border-radius: 24px;/,
  'the final workbench stylesheet should preserve the leaderboard pill width when it opens'
)
assert.doesNotMatch(
  css,
  /\.office-workbench-stage > \.workbench-leaderboard\.is-open \{[^}]*\b(?:width|max-width)\s*:\s*min\(430px/,
  'no later workbench rule may widen the expanded leaderboard'
)
assert.doesNotMatch(
  css,
  /@media \(max-width: 520px\) \{[\s\S]*?\.office-workbench-stage > \.workbench-leaderboard\.is-open \{/,
  'small screens should retain the same collapsed and expanded leaderboard width'
)
assert.match(
  leaderboardPillCss,
  /\.workbench-leaderboard-reveal \{[\s\S]*height: 0;[\s\S]*overflow: hidden;[\s\S]*height 300ms/,
  'collapsed leaderboard content should be vertically clipped with a smooth height transition'
)
assert.match(
  leaderboard,
  /const \[revealHeight, setRevealHeight\] = useState\(0\)[\s\S]*revealRef[\s\S]*scrollHeight[\s\S]*style=\{\{ height: `\$\{revealHeight\}px` \}\}/,
  'leaderboard should measure its detail content and animate an explicit height in both directions'
)

assert.match(
  css,
  /\.office-workbench-stage \.workbench-tools > \.workbench-pomodoro-card:not\(\.is-open\):not\(\.is-closing\) \{[\s\S]*border-radius: 999px;/,
  'collapsed pomodoro should use the same pill shape as the leaderboard'
)
assert.match(
  css,
  /\.office-workbench-stage \.workbench-tools > \.workbench-pomodoro-card\.is-open,[\s\S]*\.workbench-tools > \.workbench-pomodoro-card\.is-closing \{[\s\S]*border-radius: 24px;/,
  'expanded and closing pomodoro should keep rounded outer corners'
)
assert.match(
  css,
  /\.workbench-pomodoro-panel \{[\s\S]*transform: translateY\(-9px\)[\s\S]*transition: transform 300ms cubic-bezier\(0\.65, 0, 0\.35, 1\)/,
  'expanded pomodoro should reuse the leaderboard downward reveal motion'
)
assert.doesNotMatch(
  css,
  /\.office-workbench-stage \.workbench-tools > \.workbench-pomodoro-card\.is-open \{[^}]*\b(?:width|max-width)\s*:/,
  'expanded pomodoro should keep the collapsed card width and only grow downward'
)

assert.match(
  css,
  /\.office-workbench-stage \.workbench-tools \{[\s\S]*height: var\(--workbench-tools-layout-height\);[\s\S]*max-height: var\(--workbench-tools-layout-height\);[\s\S]*padding-bottom: 0;[\s\S]*overflow: visible;/,
  'tools layer should span the stage so the task list can sit at the bottom-right'
)
assert.match(
  css,
  /\.office-workbench-stage \.workbench-tools > \.workbench-task-card \{[\s\S]*margin-top: auto;/,
  'task list should be anchored to the bottom of the right-side tools layer'
)
assert.match(
  css,
  /\.office-workbench-stage \.workbench-tools > \.workbench-task-card:not\(\.is-open\):not\(\.is-closing\) \{[\s\S]*border-radius: 999px;/,
  'collapsed task list should use the same pill shape as the timer and leaderboard'
)
assert.match(
  css,
  /\.office-workbench-stage \.workbench-tools > \.workbench-task-card\.is-open,[\s\S]*\.workbench-tools > \.workbench-task-card\.is-closing \{[\s\S]*border-radius: 24px;/,
  'expanded and closing task list should keep rounded outer corners'
)
assert.match(
  css,
  /\.workbench-task-panel \{[\s\S]*transform: translateY\(9px\)[\s\S]*transform-origin: bottom center[\s\S]*transition: transform 300ms cubic-bezier\(0\.65, 0, 0\.35, 1\)/,
  'expanded task list should reuse the leaderboard upward reveal motion'
)
assert.doesNotMatch(
  css,
  /workbench-(?:pomodoro|task)-card:hover|workbench-disclosure-card:hover/,
  'timer and task cards should not add a hover ring, shadow, or brightness effect'
)
assert.match(
  css,
  /\.workbench-tools button:not\(\.workbench-disclosure-toggle\):hover/,
  'disclosure headers should be excluded from the generic hover movement'
)
assert.match(
  css,
  /\.workbench-disclosure-label,[\s\S]*\.workbench-disclosure-meta \{[^}]*transition: none;[\s\S]*\.workbench-disclosure-toggle strong,[\s\S]*\.workbench-disclosure-toggle svg \{[^}]*transition: none;/,
  'disclosure text and icons should not animate on hover'
)
assert.match(
  css,
  /\.workbench-tools button:not\(\.workbench-disclosure-toggle\):active/,
  'disclosure headers should be excluded from generic pressed movement'
)
assert.match(
  css,
  /\.workbench-disclosure-toggle,[\s\S]*\.workbench-disclosure-toggle:active \{[\s\S]*transform: none;[\s\S]*filter: none;[\s\S]*transition: none;/,
  'disclosure headers should remove the extra pressed click feedback'
)
assert.doesNotMatch(
  css,
  /workbench-pomodoro-drop-in|workbench-task-rise-in|clip-path:/,
  'disclosure cards should not keep the old one-way keyframe and clip-path animations'
)
assert.doesNotMatch(
  css,
  /\.office-workbench-stage > \.workbench-disclosure-card:hover,[^}]*var\(--accent\)/,
  'shared card hover should not use the theme accent color'
)
assert.match(css, /\.workbench-leaderboard-panel \{/, 'expanded workbench leaderboard should have dedicated styling')
assert.match(
  css,
  /\.office-workbench-stage > \.workbench-leaderboard \.workbench-leaderboard-panel \{[\s\S]*height: 268px;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
  'expanded leaderboard panel should be a flat fixed-height body inside the outer card, not a nested glass card'
)
assert.match(
  css,
  /\.office-workbench-stage > \.workbench-leaderboard \.workbench-leaderboard-panel::before,[\s\S]*::after \{[\s\S]*display: none;/,
  'expanded leaderboard panel must not paint a second sheen/card layer'
)
assert.match(
  css,
  /\.workbench-leaderboard-actions \{[\s\S]*grid-template-columns:/,
  'leaderboard room actions should use a side-by-side grid layout'
)

assert.match(
  css,
  /\.workbench-leaderboard-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;/,
  'leaderboard rows should use a flat two-column name-and-time layout'
)
assert.match(
  css,
  /\.workbench-leaderboard-actions \.workbench-room-join \{[^}]*border-radius: 999px;[^}]*box-shadow: none;/,
  'room code entry should use a flat capsule field'
)
assert.match(
  css,
  /\.workbench-leaderboard-actions \.workbench-room-join input:focus,[\s\S]*input:focus-visible \{[^}]*outline: 0;[^}]*box-shadow: none;/,
  'room code input should not render a second rectangular focus highlight'
)

assert.match(
  css,
  /\.workbench-room-random \{[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;/,
  'random room action should read as a bare icon rather than a square button'
)
assert.match(
  css,
  /\.workbench-leaderboard-actions \.workbench-room-join button \{[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;/,
  'join action should read as a bare enter icon inside the room field'
)

const removedStudyCopy = `${app}\n${viewModel}`
assert.doesNotMatch(removedStudyCopy, /本空间专注榜/, 'removed study space page should no longer show its old focus leaderboard')
assert.doesNotMatch(removedStudyCopy, /人数来自同空间的实时同步/, 'removed study space page should no longer show the removed online-count explanation')
assert.doesNotMatch(removedStudyCopy, /study-leaderboard|study-invite-note|view === 'studio'|id: 'studio'/, 'app should no longer render the removed study space page')

console.log('workbench leaderboard checks passed')
