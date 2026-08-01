import type { ReactElement } from 'react'
import { ConversationsView } from './ConversationsView'

/**
 * Legacy route fixture retained for the pre-shared Web shell. The current
 * authenticated Web surface renders the shared desktop renderer App instead.
 */
export const route = {
  path: '/conversations',
  label: '对话',
  element: <ConversationsView /> as ReactElement
}
