export const WORKBENCH_ROUTES = ['room', 'schedule', 'analytics'] as const

export type WorkbenchRoute = (typeof WORKBENCH_ROUTES)[number]
export type WorkbenchHistoryMode = 'push' | 'replace'

type WorkbenchLocation = Pick<Location, 'pathname' | 'search' | 'hash'>
type WorkbenchHistory = Pick<History, 'pushState' | 'replaceState'>
type WorkbenchNavigationTarget = {
  location: WorkbenchLocation
  history: WorkbenchHistory
}

const workbenchRouteParam = 'workbench'
const legacyScheduleParam = 'studySchedule'

export function parseWorkbenchRoute(search: string): WorkbenchRoute {
  try {
    const params = new URLSearchParams(search)
    const route = params.get(workbenchRouteParam)

    if (route === 'analytics') return 'analytics'
    if (route === 'schedule') return 'schedule'
    if (route === 'room' || route === '1') return 'room'
    if (route === null && params.has(legacyScheduleParam)) return 'schedule'

    return 'room'
  } catch {
    return 'room'
  }
}

export function workbenchRouteParamValue(route: WorkbenchRoute): string {
  return route === 'room' ? '1' : route
}

export function createWorkbenchRouteUrl(location: WorkbenchLocation, route: WorkbenchRoute): string {
  const params = new URLSearchParams(location.search)
  params.delete(legacyScheduleParam)
  params.set(workbenchRouteParam, workbenchRouteParamValue(route))
  const search = params.toString()
  return `${location.pathname}${search ? `?${search}` : ''}${location.hash}`
}

export function navigateWorkbenchRoute(
  route: WorkbenchRoute,
  mode: WorkbenchHistoryMode = 'push',
  target: WorkbenchNavigationTarget = window
): boolean {
  try {
    const nextUrl = createWorkbenchRouteUrl(target.location, route)
    const currentUrl = `${target.location.pathname}${target.location.search}${target.location.hash}`
    if (nextUrl === currentUrl) return false

    if (mode === 'replace') {
      target.history.replaceState(null, '', nextUrl)
    } else {
      target.history.pushState(null, '', nextUrl)
    }
    return true
  } catch {
    // URL sync is best-effort. Callers must still update their local React state.
    return false
  }
}
