/**
 * Legacy route fixture retained for the pre-shared Web shell. It is not
 * imported by the current shared renderer App.
 */
import { StudyRoomView } from './StudyRoomView'

export const route = {
  path: '/study-room',
  label: '自习室',
  element: <StudyRoomView />
}
