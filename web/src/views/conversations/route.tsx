import type { ReactElement } from 'react'
import { ConversationsView } from './ConversationsView'

/**
 * Route module for the Conversations / 对话历史 browse feature
 * (plan §8 Phase 6b / §7.1). Auto-discovered by App.tsx, which globs every
 * `route.tsx` module under web/src/views/.
 */
export const route = {
  path: '/conversations',
  label: '对话',
  element: <ConversationsView /> as ReactElement
}
