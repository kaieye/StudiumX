import type { ReactElement } from 'react'
import { LessonsView } from './LessonsView'

/**
 * Legacy route fixture retained for the pre-shared Web shell. It is not
 * imported by the current shared renderer App.
 */
export const route = {
  path: '/lessons',
  label: '课程',
  element: <LessonsView /> as ReactElement
}
