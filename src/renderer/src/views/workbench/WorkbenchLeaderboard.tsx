import { Trophy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatStudyHours, studySignalShortLabel } from '../../study-space/domain'
import type { StudyPresenceStatus } from '../../study-space/types'
import type { StudyRoomMember } from '../../study-space/viewModel'
import { WorkbenchRoomSwitcher } from './WorkbenchRoomSwitcher'

const LEADERBOARD_REVEAL_DURATION_MS = 300

type WorkbenchLeaderboardProps = {
  members: StudyRoomMember[]
  presenceStatus: StudyPresenceStatus
  spaceCode: string
  onEnterRandomSpace: () => void
  onJoinSpace: (spaceCode: string) => void
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
  const [open, setOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [revealHeight, setRevealHeight] = useState(0)
  const revealRef = useRef<HTMLDivElement>(null)
  const collapseTimerRef = useRef<number | undefined>(undefined)
  const selfRank = Math.max(1, members.findIndex((member) => member.isSelf) + 1)
  const totalMembers = Math.max(1, members.length)

  useEffect(() => () => {
    if (collapseTimerRef.current !== undefined) {
      window.clearTimeout(collapseTimerRef.current)
    }
  }, [])

  const toggleLeaderboard = (): void => {
    if (collapseTimerRef.current !== undefined) {
      window.clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = undefined
    }

    if (open) {
      setOpen(false)
      setIsClosing(true)
      // Animate an explicit pixel height instead of a fractional grid track.
      // A 1fr → 0fr grid transition shrinks non-linearly in Chromium, which
      // made the close look like it disappeared before the 300ms duration.
      setRevealHeight(0)
      collapseTimerRef.current = window.setTimeout(() => {
        setIsClosing(false)
        collapseTimerRef.current = undefined
      }, LEADERBOARD_REVEAL_DURATION_MS)
      return
    }

    setIsClosing(false)
    setRevealHeight(revealRef.current?.scrollHeight ?? 0)
    setOpen(true)
  }

  return (
    <section className={`workbench-leaderboard${open ? ' is-open' : ''}${isClosing ? ' is-closing' : ''}`} aria-label="自习室榜单">
      <button
        type="button"
        className="workbench-leaderboard-toggle workbench-leaderboard-header"
        onClick={toggleLeaderboard}
        aria-expanded={open}
        aria-controls="workbench-leaderboard-panel"
      >
        <span className="workbench-leaderboard-label">
          <Trophy size={15} />
          自习室榜单
          <i className={`workbench-heartbeat-dot is-${presenceStatus}`} title={presenceStatusLabel(presenceStatus)} aria-label={presenceStatusLabel(presenceStatus)} />
          <code className="workbench-leaderboard-space-code">{spaceCode}</code>
        </span>
        <strong>#{selfRank}/{totalMembers}</strong>
      </button>
      <div
        ref={revealRef}
        className="workbench-leaderboard-reveal"
        style={{ height: `${revealHeight}px` }}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="workbench-leaderboard-reveal-inner">
          <section id="workbench-leaderboard-panel" className="workbench-leaderboard-panel" aria-label="自习室榜单明细">
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
