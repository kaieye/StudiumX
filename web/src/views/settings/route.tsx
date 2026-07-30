/**
 * Feature route module - auto-discovered by App.tsx (which globs every
 * `route.tsx` module under web/src/views/). See App.tsx for the contract.
 */
import { SettingsView } from './SettingsView'

export const route = {
  path: '/settings',
  label: '设置',
  element: <SettingsView />
}
