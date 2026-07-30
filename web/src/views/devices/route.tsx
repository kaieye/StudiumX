import type { ReactElement } from 'react'
import { DevicesView } from './DevicesView'

/**
 * Feature route module - auto-discovered by App.tsx (which globs every
 * `route.tsx` module under web/src/views/). See App.tsx for the contract.
 */
export const route = {
  path: '/devices',
  label: '设备',
  element: <DevicesView /> as ReactElement
}
