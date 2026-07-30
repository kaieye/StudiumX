import type { ReactElement } from 'react'
import { LessonsView } from './LessonsView'

/**
 * Feature route module - auto-discovered by App.tsx (which globs every
 * `route.tsx` module under web/src/views/). See App.tsx for the contract.
 */
export const route = {
  path: '/lessons',
  label: '课程',
  element: <LessonsView /> as ReactElement
}
