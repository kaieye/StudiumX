/**
 * Legacy route fixture retained for the pre-shared Web shell. It is not
 * imported by the current shared renderer App.
 */
import { SettingsView } from './SettingsView'

export const route = {
  path: '/settings',
  label: '设置',
  element: <SettingsView />
}
