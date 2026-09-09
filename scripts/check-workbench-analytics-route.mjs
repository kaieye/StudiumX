import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createWorkbenchRouteUrl,
  navigateWorkbenchRoute,
  parseWorkbenchRoute,
  workbenchRouteParamValue
} from '../src/renderer/src/views/workbench/workbenchRoute.ts'

const [workbenchSource, routeSource, cssSource, runtimeSource, tasksSource] = await Promise.all([
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/workbenchRoute.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/workbench-analytics-entry.css', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-scene-runtime.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchTasks.tsx', 'utf8')
])

assert.equal(parseWorkbenchRoute(''), 'room')
assert.equal(parseWorkbenchRoute('?workbench=1'), 'room')
assert.equal(parseWorkbenchRoute('?workbench=room'), 'room')
assert.equal(parseWorkbenchRoute('?workbench=schedule'), 'schedule')
assert.equal(parseWorkbenchRoute('?studySchedule=1'), 'schedule')
assert.equal(parseWorkbenchRoute('?workbench=analytics'), 'analytics')
assert.equal(parseWorkbenchRoute('?workbench=analytics&studySchedule=1'), 'analytics')
assert.equal(parseWorkbenchRoute('?workbench=unexpected'), 'room')
assert.equal(parseWorkbenchRoute('?workbench=unexpected&studySchedule=1'), 'room')
assert.equal(
  parseWorkbenchRoute({ toString: () => { throw new Error('unavailable URL') } }),
  'room',
  'route parsing should fail closed to room'
)

assert.equal(workbenchRouteParamValue('room'), '1')
assert.equal(workbenchRouteParamValue('schedule'), 'schedule')
assert.equal(workbenchRouteParamValue('analytics'), 'analytics')
assert.equal(
  createWorkbenchRouteUrl(
    { pathname: '/app', search: '?course=math&studySchedule=1', hash: '#focus' },
    'analytics'
  ),
  '/app?course=math&workbench=analytics#focus',
  'analytics URL should preserve unrelated state and remove the legacy schedule flag'
)

const pushCalls = []
const replaceCalls = []
const target = {
  location: { pathname: '/app', search: '?workbench=1', hash: '' },
  history: {
    pushState: (...args) => pushCalls.push(args),
    replaceState: (...args) => replaceCalls.push(args)
  }
}
assert.equal(navigateWorkbenchRoute('analytics', 'push', target), true)
assert.equal(pushCalls.length, 1, 'opening analytics should issue exactly one pushState call')
assert.equal(pushCalls[0][2], '/app?workbench=analytics')
assert.equal(replaceCalls.length, 0)

assert.equal(navigateWorkbenchRoute('room', 'push', target), false, 'same room URL should not add history')
assert.equal(pushCalls.length, 1)

const directAnalyticsTarget = {
  location: { pathname: '/app', search: '?workbench=analytics', hash: '#insights' },
  history: {
    pushState: (...args) => pushCalls.push(args),
    replaceState: (...args) => replaceCalls.push(args)
  }
}
assert.equal(navigateWorkbenchRoute('room', 'replace', directAnalyticsTarget), true)
assert.equal(replaceCalls.at(-1)?.[2], '/app?workbench=1#insights')

const throwingTarget = {
  location: { pathname: '/app', search: '?workbench=1', hash: '' },
  history: {
    pushState: () => { throw new Error('History API unavailable') },
    replaceState: () => { throw new Error('History API unavailable') }
  }
}
assert.equal(
  navigateWorkbenchRoute('analytics', 'push', throwingTarget),
  false,
  'History API failures should be contained so local React state can continue'
)

assert.match(routeSource, /WORKBENCH_ROUTES = \['room', 'schedule', 'analytics'\] as const/)
assert.doesNotMatch(workbenchSource, /scheduleOpen|isStudyScheduleRoute|ensureWorkbenchRouteParam/)
assert.ok(
  workbenchSource.indexOf('useStudySession({') < workbenchSource.indexOf("if (route === 'analytics')"),
  'useStudySession must remain above analytics and schedule render branches'
)
assert.match(workbenchSource, /window\.addEventListener\('popstate', handlePopState\)/)
assert.match(workbenchSource, /const nextRoute = parseWorkbenchRoute\(window\.location\.search\)/)
assert.match(
  workbenchSource,
  /const openStudyAnalytics[\s\S]*navigateWorkbenchRoute\('analytics'\)[\s\S]*setRoute\('analytics'\)/,
  'analytics entry should sync the URL once and then update local state'
)
assert.match(
  workbenchSource,
  /const closeStudyAnalytics[\s\S]*restoreAnalyticsFocusRef\.current = true[\s\S]*setOpenTasksPanelForAnalytics\(true\)[\s\S]*navigateWorkbenchRoute\('room', 'replace'\)[\s\S]*setRoute\('room'\)/,
  'analytics back should canonicalize room locally even when history is unavailable'
)
assert.match(workbenchSource, /analyticsButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/)
assert.match(
  workbenchSource,
  /if \(route !== 'room'\) return[\s\S]*createOfficeSceneRuntime\(\{[\s\S]*runtime\.mount\(\)[\s\S]*runtime\.update\(seatState\)[\s\S]*runtime\.dispose\(\)/,
  'room scene should mount through the runtime only while route is room and dispose on leave'
)
assert.match(
  runtimeSource,
  /new ResizeObserver\(updateCanvasSize\)[\s\S]*resizeObserver\.observe\(stage\)/,
  'scene runtime should observe stage size changes while mounted'
)
assert.match(
  runtimeSource,
  /animationFrame = requestAnimationFrame\(/,
  'scene runtime should drive canvas renders through requestAnimationFrame'
)
assert.doesNotMatch(
  runtimeSource,
  /addEventListener\('pointermove'/,
  'scene runtime has no inline canvas pointermove listener contract'
)
assert.match(
  workbenchSource,
  /<WorkbenchAnalyticsPage[\s\S]*?onBack=\{closeStudyAnalytics\}/,
  'analytics page should be wired to closeStudyAnalytics back handler'
)
assert.match(
  tasksSource,
  /aria-label="打开学习分析"[\s\S]*<ChartColumn[\s\S]*<span>学习分析<\/span>/,
  'analytics entry button should remain discoverable in the task panel'
)
assert.match(
  workbenchSource,
  /<WorkbenchTasks[\s\S]*onOpenAnalytics=\{openStudyAnalytics\}/,
  'task panel should be wired to openStudyAnalytics'
)

assert.match(cssSource, /\.workbench-analytics-back \{[\s\S]*min-height: 44px/)
assert.match(cssSource, /\.workbench-analytics-back:active \{[\s\S]*scale\(var\(--lg-press-scale, 0\.97\)\)/)
assert.match(cssSource, /\.workbench-analytics-back:focus-visible/)
assert.match(cssSource, /-webkit-app-region: no-drag/)
assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/)
assert.match(cssSource, /@media \(prefers-reduced-transparency: reduce\)/)

console.log('workbench analytics route checks passed')
