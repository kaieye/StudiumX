import { ChevronDown, Copy, ExternalLink, GitBranch, LinkIcon, Lock, Maximize2, Monitor, Plus, RefreshCw, Settings, Timer, Users } from 'lucide-react'
import type { FormEvent } from 'react'
import { STUDY_PRESENCE_BROKER_URL } from './constants'
import { formatStudyDuration, formatStudySeatLabel, normalizeStudySeatIndex, studyMemberFreshnessLabel, studyMemberStatusLabel } from './domain'
import type { useStudySession } from './session/useStudySession'
import type { StudySnapshot } from './types'
import type { StudySpaceViewModel } from './viewModel'

type StudyPresence = ReturnType<typeof useStudySession>['presence']

type StudyArrivalPanelProps = {
  activeRoom: StudySpaceViewModel['activeRoom']
  snapshot: StudySnapshot
  presence: StudyPresence
  roomCycleNow: number
  roomCycle: StudySpaceViewModel['roomCycle']
  online: number
  spaceOnline: number
  remoteOnline: number
  roomCapacityPercent: number
  focusingCount: number
  remoteFreshValue: string
  arrivalRosterMembers: StudySpaceViewModel['arrivalRosterMembers']
  latestRemotePeer: StudySpaceViewModel['latestRemotePeer']
  liveLineCode: StudySpaceViewModel['liveLineCode']
  liveLineText: string
  liveLineMeta: string
  liveSessionTitle: string
  liveSessionDetail: string
  relayHealthLabel: string
  contractDisplay: string
  topicTail: string
  presenceProofRows: StudySpaceViewModel['presenceProofRows']
  inviteUrl: string
  inviteHint: string
  spaceKindLabel: string
  relayDraft: string
  copyState: 'idle' | 'copied' | 'failed'
  proofCopyState: 'idle' | 'copied' | 'failed'
  verifyOpenState: 'idle' | 'opened' | 'blocked'
  onRelayDraftChange: (value: string) => void
  onCreateSpace: () => void
  onCopyInvite: () => void
  onCopyPresenceProof: () => void
  onOpenVerificationWindow: () => void
  onFollowRoomCycle: () => void
  onOpenFocusTheater: () => void
  onSaveRelayUrl: (event: FormEvent<HTMLFormElement>) => void
  onResetRelayUrl: () => void
}

export function StudyArrivalPanel({
  activeRoom,
  snapshot,
  presence,
  roomCycleNow,
  roomCycle,
  online,
  spaceOnline,
  remoteOnline,
  roomCapacityPercent,
  focusingCount,
  remoteFreshValue,
  arrivalRosterMembers,
  latestRemotePeer,
  liveLineCode,
  liveLineText,
  liveLineMeta,
  liveSessionTitle,
  liveSessionDetail,
  relayHealthLabel,
  contractDisplay,
  topicTail,
  presenceProofRows,
  inviteUrl,
  inviteHint,
  spaceKindLabel,
  relayDraft,
  copyState,
  proofCopyState,
  verifyOpenState,
  onRelayDraftChange,
  onCreateSpace,
  onCopyInvite,
  onCopyPresenceProof,
  onOpenVerificationWindow,
  onFollowRoomCycle,
  onOpenFocusTheater,
  onSaveRelayUrl,
  onResetRelayUrl
}: StudyArrivalPanelProps) {
  return (
    <details className="study-arrival" aria-label="联机与邀请设置">
      <summary className="study-arrival-summary">
        <span><Settings size={14} /> 联机与邀请</span>
        <strong>{online}/{activeRoom.capacity} 在线 · {remoteOnline} 远端 · {relayHealthLabel}</strong>
        <ChevronDown size={14} />
      </summary>
      <div className="study-arrival-body">
        <div className="study-arrival-live">
          <div className="study-arrival-head">
            <div>
              <span className="study-kicker"><Users size={14} /> 真实在线</span>
              <h2>同桌在线</h2>
            </div>
            <span className={`study-relay-badge is-${presence.status}`}>{relayHealthLabel}</span>
          </div>
          <div className="study-arrival-counts">
            <div>
              <strong>{online}</strong>
              <span>当前在线</span>
            </div>
            <div>
              <strong>{spaceOnline}</strong>
              <span>本空间在线</span>
            </div>
            <div>
              <strong>{remoteOnline}</strong>
              <span>远端会话</span>
            </div>
          </div>
          <div className={`study-room-pulse is-${presence.status}${latestRemotePeer ? ' has-peer' : ''}`} aria-label="实时状态">
            <div className="study-room-pulse-main">
              <span>{liveLineCode}</span>
              <div>
                <strong>{liveLineText}</strong>
                <small>{liveLineMeta}</small>
              </div>
            </div>
            <div className="study-room-pulse-stats">
              <div>
                <strong>{focusingCount}</strong>
                <span>专注中</span>
              </div>
              <div>
                <strong>{remoteFreshValue}</strong>
                <span>远端心跳</span>
              </div>
              <div>
                <strong>{online}/{activeRoom.capacity}</strong>
                <span>容量</span>
              </div>
            </div>
            <div className="study-room-pulse-meter" aria-hidden="true">
              <span style={{ width: `${roomCapacityPercent}%` }} />
            </div>
          </div>
          <div className="study-arrival-roster" aria-label="入座同桌">
            {arrivalRosterMembers.map((member) => (
              <div className={`study-arrival-roster-seat${member.isSelf ? ' is-me' : ''}`} key={member.clientId}>
                <span>{member.nickname.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{member.isSelf ? '我的席位' : member.nickname}</strong>
                  <small>{formatStudySeatLabel(normalizeStudySeatIndex(member.seatIndex, member.roomId, member.clientId))} · {studyMemberStatusLabel(member.status, member.timerMode)} · {studyMemberFreshnessLabel(member, roomCycleNow)}</small>
                </div>
              </div>
            ))}
            <div className="study-arrival-roster-seat is-empty">
              <span><Plus size={13} /></span>
              <div>
                <strong>{presence.status === 'online' ? '等待同桌入座' : '等待同步服务'}</strong>
                <small>{presence.status === 'online' ? '复制邀请或打开同桌窗口后才会增加人数' : '同步恢复后才会显示远端席位'}</small>
              </div>
            </div>
          </div>
          <div className={`study-presence-test is-${presence.status}${remoteOnline > 0 ? ' has-peer' : ''}`}>
            <div>
              <span className="study-kicker"><Monitor size={14} /> 邀请同桌</span>
              <strong>{liveSessionTitle}</strong>
              <p>{liveSessionDetail}</p>
            </div>
            <button type="button" onClick={onOpenVerificationWindow} disabled={presence.status !== 'online'}>
              <ExternalLink size={14} />
              {remoteOnline > 0 ? '再开一个同桌' : verifyOpenState === 'opened' ? '已打开同桌窗口' : verifyOpenState === 'blocked' ? '窗口被拦截' : '开同桌窗口'}
            </button>
          </div>
          <div className="study-arrival-actions">
            <button type="button" onClick={onCopyInvite}>
              <Copy size={14} />
              {copyState === 'copied' ? '已复制邀请' : '复制邀请'}
            </button>
            <button type="button" onClick={onCreateSpace}>
              <Lock size={14} />
              新建私密空间
            </button>
          </div>
          <details className="study-online-proof">
            <summary>
              <span><GitBranch size={14} /> 在线证明</span>
              <ChevronDown size={14} />
            </summary>
            <div className="study-online-proof-grid">
              <div className="study-online-proof-topic">
                <span>Presence topic</span>
                <strong>{topicTail}</strong>
              </div>
              <div className="study-online-proof-topic">
                <span>Relay</span>
                <strong>{presence.relay}</strong>
              </div>
              {presenceProofRows.map((row) => (
                <div className="study-proof-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
            <button type="button" onClick={onCopyPresenceProof}>
              <Copy size={13} />
              {proofCopyState === 'copied' ? '已复制证明' : proofCopyState === 'failed' ? '复制失败' : '复制在线证明'}
            </button>
          </details>
          <div className="study-arrival-link" title={inviteUrl}>
            <LinkIcon size={13} />
            <span>{inviteUrl}</span>
          </div>
          <div className="study-invite-strip" aria-label="邀请状态">
            <div title={inviteHint}>
              <span>空间码</span>
              <strong>{snapshot.spaceCode}</strong>
            </div>
            <div>
              <span>空间类型</span>
              <strong>{spaceKindLabel}</strong>
            </div>
            <div>
              <span>邀请</span>
              <strong>{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '待发送'}</strong>
            </div>
            <div>
              <span>验证</span>
              <strong>{remoteOnline > 0 ? '已见远端' : verifyOpenState === 'opened' ? '窗口已开' : verifyOpenState === 'blocked' ? '被拦截' : '待验证'}</strong>
            </div>
          </div>
        </div>

        <div className="study-arrival-focus">
          <div className="study-arrival-head">
            <div>
              <span className="study-kicker"><Timer size={14} /> 学习节奏</span>
              <h2>{roomCycle.phase === 'focus' ? '同频专注中' : '同步休息中'}</h2>
            </div>
            <strong className="study-arrival-clock">{formatStudyDuration(roomCycle.remainingSeconds)}</strong>
          </div>
          <p>第 {roomCycle.round} 轮，下一段是{roomCycle.nextLabel}。当前目标：{contractDisplay}</p>
          <div className="study-arrival-meter" aria-hidden="true">
            <span style={{ width: `${roomCapacityPercent}%` }} />
          </div>
          <div className="study-arrival-actions">
            <button type="button" onClick={onFollowRoomCycle}>
              <RefreshCw size={14} />
              跟随节奏
            </button>
            <button type="button" onClick={onOpenFocusTheater}>
              <Maximize2 size={14} />
              沉浸开始
            </button>
          </div>
        </div>

        <div className="study-arrival-connection">
          <div className="study-arrival-head">
            <div>
              <span className="study-kicker"><Settings size={14} /> 连接设置</span>
              <h2>连接设置</h2>
            </div>
            <span>{snapshot.spaceCode}</span>
          </div>
          <details className="study-relay-settings">
            <summary>
              <span><Settings size={14} /> 连接设置</span>
              <ChevronDown size={14} />
            </summary>
            <form className="study-arrival-relay" onSubmit={onSaveRelayUrl}>
              <GitBranch size={14} />
              <input
                value={relayDraft}
                onChange={(event) => onRelayDraftChange(event.target.value)}
                placeholder={STUDY_PRESENCE_BROKER_URL}
                aria-label="MQTT WebSocket relay 地址"
              />
              <button type="submit">连接</button>
              <button type="button" onClick={onResetRelayUrl}>默认</button>
            </form>
            <div className="study-relay-status">
              <span>当前 relay</span>
              <strong>{presence.relay}</strong>
              <em>失败时会自动尝试备用公共 relay。</em>
            </div>
          </details>
        </div>
      </div>
    </details>
  )
}
