/**
 * Web conversation entry guard.
 *
 * Agent chat is intentionally desktop-only: it depends on the local learning
 * workspace and the desktop teaching runtime. The web dashboard must never
 * initialize an agent run, stream a response, or fetch/render a conversation
 * as a substitute. Direct visits to /conversations receive the same explicit
 * guidance as the sidebar and home chat affordances.
 */

import { useEffect } from 'react'
import { Monitor } from 'lucide-react'
import { useDesktopOnlyChatDialog } from '../../chat/DesktopOnlyChatDialog'

export function ConversationsView() {
  const { openDesktopOnlyChatDialog } = useDesktopOnlyChatDialog()

  useEffect(() => {
    openDesktopOnlyChatDialog()
  }, [openDesktopOnlyChatDialog])

  return (
    <main className="web-unavailable-page">
      <section className="web-unavailable-card" aria-labelledby="desktop-chat-page-title">
        <span className="web-unavailable-icon" aria-hidden="true"><Monitor size={24} /></span>
        <h1 id="desktop-chat-page-title">对话服务仅在桌面端提供</h1>
        <p>
          为保护本地学习工作区和教学过程，Web 端不会启动、继续或展示学习助手对话。请在桌面端使用对话服务。
        </p>
        <button type="button" className="web-primary-button" onClick={openDesktopOnlyChatDialog}>
          查看使用说明
        </button>
      </section>
    </main>
  )
}
