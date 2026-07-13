import { Trophy } from 'lucide-react'
import { formatStudyHours, studySignalShortLabel } from '../../study-space/domain'
import type { StudyPresenceStatus } from '../../study-space/types'
import type { StudyRoomMember } from '../../study-space/viewModel'

type WorkbenchLeaderboardProps = {
  members: StudyRoomMember[]
  presenceStatus: StudyPresenceStatus
}

function presenceStatusLabel(status: StudyPresenceStatus): string {
  if (status === 'online') return '心跳在线'
  if (status === 'connecting') return '心跳连接中'
  return '心跳离线'
}

export function WorkbenchLeaderboard({ members, presenceStatus }: WorkbenchLeaderboardProps) {
  const selfRank = Math.max(1, members.findIndex((member) => member.isSelf) + 1)
  const totalMembers = Math.max(1, members.length)

  return (
    <section className="workbench-leaderboard is-open" aria-label="自习室榜单">
      <header className="workbench-leaderboard-header">
        <span className="workbench-leaderboard-label">
          <Trophy size={15} />
          自习室榜单
          <i className={`workbench-heartbeat-dot is-${presenceStatus}`} title={presenceStatusLabel(presenceStatus)} aria-label={presenceStatusLabel(presenceStatus)} />
        </span>
        <strong>#{selfRank}/{totalMembers}</strong>
      </header>
      <section id="workbench-leaderboard-panel" className="workbench-leaderboard-panel" aria-label="今日专注榜单">
        <header>
          <strong>今日专注</strong>
          <span>{totalMembers} 人</span>
        </header>
        <div className="workbench-leaderboard-list">
          {members.map((member, index) => (
            <div className={`workbench-leaderboard-row${member.isSelf ? ' is-me' : ''}`} key={member.clientId}>
              <span>#{index + 1}</span>
              <div>
                <strong>{member.nickname}</strong>
                <small>{studySignalShortLabel(member.signalId)}{member.isSelf ? ' · 我' : ''}</small>
              </div>
              <em>{formatStudyHours(member.todayFocusSeconds)}h</em>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}
