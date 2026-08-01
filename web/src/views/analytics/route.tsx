import type { ReactElement } from 'react'
import { AnalyticsView } from './AnalyticsView'

/**
 * Legacy route fixture retained for the pre-shared Web shell. It is not
 * imported by the current shared renderer App.
 */
export const route = {
  path: '/analytics',
  label: '分析',
  element: <AnalyticsView /> as ReactElement
}
