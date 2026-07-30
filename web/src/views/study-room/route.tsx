/**
 * Feature route module - auto-discovered by App.tsx (which globs every
 * `route.tsx` module under web/src/views/). See App.tsx for the contract.
 */
import { StudyRoomView } from './StudyRoomView'

export const route = {
  path: '/study-room',
  label: '自习室',
  element: <StudyRoomView />
}
