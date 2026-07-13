import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createWorkbenchRouteUrl,
  navigateWorkbenchRoute,
  parseWorkbenchRoute,
  workbenchRouteParamValue
} from '../src/renderer/src/views/workbench/workbenchRoute.ts'

const [workbenchSource, routeSource, cssSource] = await Promise.all([
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/workbenchRoute.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/workbench-analytics-entry.css', 'utf8')
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
  /const closeStudyAnalytics[\s\S]*restoreAnalyticsFabFocusRef\.current = true[\s\S]*navigateWorkbenchRoute\('room', 'replace'\)[\s\S]*setRoute\('room'\)/,
  'analytics back should canonicalize room locally even when history is unavailable'
)
assert.match(workbenchSource, /analyticsFabRef\.current\?\.focus\(\{ preventScroll: true \}\)/)
assert.match(workbenchSource, /if \(route !== 'room'\) return[\s\S]*new ResizeObserver/)
assert.match(workbenchSource, /if \(route !== 'room'\) return[\s\S]*canvas\.addEventListener\('pointermove'/)
assert.match(workbenchSource, /if \(route !== 'room'\) return[\s\S]*requestAnimationFrame\(render\)/)
assert.match(workbenchSource, /<WorkbenchAnalyticsPage onBack=\{closeStudyAnalytics\} \/>/)
assert.match(workbenchSource, /ChartColumn[\s\S]*aria-label="打开学习分析"[\s\S]*学习分析/)

assert.match(cssSource, /\.workbench-analytics-fab \{[\s\S]*min-height: 44px/)
assert.match(cssSource, /\.workbench-analytics-fab:active \{[\s\S]*scale\(0\.97\)/)
assert.match(cssSource, /\.workbench-analytics-fab:focus-visible/)
assert.match(cssSource, /-webkit-app-region: no-drag/)
assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/)
assert.match(cssSource, /@media \(prefers-reduced-transparency: reduce\)/)
assert.match(cssSource, /:root\[data-resolved-theme='dark'\] \.workbench-analytics-fab/)

console.log('workbench analytics route checks passed')
