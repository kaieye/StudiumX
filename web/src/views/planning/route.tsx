import type { ReactElement } from 'react'
import { PlanningView } from './PlanningView'

export const route = {
  path: '/planning',
  label: '计划',
  element: <PlanningView /> as ReactElement
}
