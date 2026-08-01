import type { ReactElement } from 'react'
import { DevicesView } from './DevicesView'

/**
 * Legacy route fixture retained for the pre-shared Web shell. It is not
 * imported by the current shared renderer App.
 */
export const route = {
  path: '/devices',
  label: '设备',
  element: <DevicesView /> as ReactElement
}
