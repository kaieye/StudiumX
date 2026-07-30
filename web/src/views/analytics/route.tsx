import type { ReactElement } from 'react'
import { AnalyticsView } from './AnalyticsView'

/**
 * Feature route module - auto-discovered by App.tsx (which globs every
 * `route.tsx` module under web/src/views/). See App.tsx for the contract.
 */
export const route = {
  path: '/analytics',
  label: '分析',
  element: <AnalyticsView /> as ReactElement
}
