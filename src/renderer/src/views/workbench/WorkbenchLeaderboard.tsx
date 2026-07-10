import { Trophy } from 'lucide-react'
import { useState } from 'react'
import { formatStudyHours, studySignalShortLabel } from '../../study-space/domain'
import type { StudyRoomMember } from '../../study-space/viewModel'

type WorkbenchLeaderboardProps = {
  members: StudyRoomMember[]
}

export function WorkbenchLeaderboard({ members }: WorkbenchLeaderboardProps) {
  const [open, setOpen] = useState(false)
  const selfRank = Math.max(1, members.findIndex((member) => member.isSelf) + 1)
  const totalMembers = Math.max(1, members.length)

  return (
    <div className={`workbench-leaderboard${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="workbench-leaderboard-toggle"
        aria-expanded={open}
        aria-controls="workbench-leaderboard-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <Trophy size={15} />
        <span>自习室榜单</span>
        <strong>#{selfRank}/{totalMembers}</strong>
      </button>
      {open ? (
        <section id="workbench-leaderboard-panel" className="workbench-leaderboard-panel" aria-label="自习室榜单">
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
      ) : null}
    </div>
  )
}
