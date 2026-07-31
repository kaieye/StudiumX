import { Trophy } from 'lucide-react'
import { formatStudyHours } from '../../study-space/domain'
import type { StudyPresenceStatus } from '../../study-space/types'
import type { StudyRoomMember } from '../../study-space/viewModel'
import { WorkbenchRoomSwitcher } from './WorkbenchRoomSwitcher'
import { useWorkbenchDisclosureReveal } from './useWorkbenchDisclosureReveal'

type WorkbenchLeaderboardProps = {
  members: StudyRoomMember[]
  presenceStatus: StudyPresenceStatus
  spaceCode: string
  onEnterRandomSpace: () => void
  onJoinSpace: (spaceCode: string) => Promise<boolean>
}

function presenceStatusLabel(status: StudyPresenceStatus): string {
  if (status === 'online') return '心跳在线'
  if (status === 'connecting') return '心跳连接中'
  return '心跳离线'
}

export function WorkbenchLeaderboard({
  members,
  presenceStatus,
  spaceCode,
  onEnterRandomSpace,
  onJoinSpace
}: WorkbenchLeaderboardProps) {
  const {
    open,
    isClosing,
    revealHeight,
    revealRef,
    revealInnerRef,
    toggle: toggleLeaderboard
  } = useWorkbenchDisclosureReveal()
  const selfRank = Math.max(1, members.findIndex((member) => member.isSelf) + 1)
  const totalMembers = Math.max(1, members.length)

  return (
    <section className={`workbench-disclosure-card workbench-leaderboard${open ? ' is-open' : ''}${isClosing ? ' is-closing' : ''}`} aria-label="自习室榜单">
      <button
        type="button"
        className="workbench-disclosure-toggle workbench-leaderboard-toggle workbench-leaderboard-header"
        onClick={toggleLeaderboard}
        aria-expanded={open}
        aria-controls="workbench-leaderboard-panel"
      >
        <span className="workbench-disclosure-label workbench-leaderboard-label">
          <Trophy size={15} aria-hidden="true" />
          <span className="workbench-leaderboard-title">自习室榜单</span>
          <i className={`workbench-heartbeat-dot is-${presenceStatus}`} title={presenceStatusLabel(presenceStatus)} aria-label={presenceStatusLabel(presenceStatus)} />
          <code className="workbench-leaderboard-space-code">{spaceCode}</code>
        </span>
        <strong>#{selfRank}/{totalMembers}</strong>
      </button>
      <div
        ref={revealRef}
        className="workbench-disclosure-reveal workbench-leaderboard-reveal"
        style={{ height: `${revealHeight}px` }}
        aria-hidden={!open}
        inert={!open}
      >
        <div ref={revealInnerRef} className="workbench-disclosure-reveal-inner workbench-leaderboard-reveal-inner">
          <section id="workbench-leaderboard-panel" className="workbench-disclosure-panel workbench-leaderboard-panel" aria-label="自习室榜单明细">
            <div className="workbench-leaderboard-list">
              {members.map((member) => (
                <div className={`workbench-leaderboard-row${member.isSelf ? ' is-me' : ''}`} key={member.clientId}>
                  <strong>{member.nickname}</strong>
                  <em>{formatStudyHours(member.todayFocusSeconds)}h</em>
                </div>
              ))}
            </div>
            <WorkbenchRoomSwitcher
              onEnterRandomSpace={onEnterRandomSpace}
              onJoinSpace={onJoinSpace}
            />
          </section>
        </div>
      </div>
    </section>
  )
}
