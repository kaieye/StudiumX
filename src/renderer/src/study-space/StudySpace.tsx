import { CheckCircle2, ChevronDown, Coffee, Copy, DoorOpen, ExternalLink, GitBranch, Info, KeyRound, Maximize2, Pause, Play, RefreshCw, Target, Trophy, Users, X, Zap } from 'lucide-react'
import type { CSSProperties, FormEvent } from 'react'
import { useEffect, useState } from 'react'
import studyRoomAmbience from '../assets/study-room-ambience.webp'
import { STUDY_PRESENCE_BROKER_URL } from './constants'
import { formatStudyDuration, formatStudyEventTime, formatStudyHours, formatStudyPresenceAge, formatStudySeatLabel, normalizeStudySeatIndex, studyMemberFreshnessLabel, studyMemberStatusLabel, studySignalLabel, studySignalShortLabel, studyVerificationUrl } from './domain'
import { useStudySession } from './session/useStudySession'
import { StudyArrivalPanel } from './StudyArrivalPanel'
import { StudyRoomStage } from './StudyRoomStage'
import { StudyWorkPanels } from './StudyWorkPanels'
import './styles.css'

type StudySpaceProps = {
  showNotification: (title: string, body: string) => Promise<void>
}

export function StudySpace({ showNotification }: StudySpaceProps) {
  const [taskInput, setTaskInput] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [spaceDraft, setSpaceDraft] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [proofCopyState, setProofCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [verifyOpenState, setVerifyOpenState] = useState<'idle' | 'opened' | 'blocked'>('idle')
  const [focusTheaterOpen, setFocusTheaterOpen] = useState(false)
  const session = useStudySession({
    showNotification,
    openFocusTheater: () => setFocusTheaterOpen(true)
  })
  const {
    snapshot,
    presence,
    roomCycleNow,
    viewModel,
    emitRoomEvent,
    saveNickname: saveSessionNickname,
    joinSpace: joinSessionSpace,
    createSpace: createSessionSpace,
    saveRelayUrl: saveSessionRelayUrl,
    resetRelayUrl: resetSessionRelayUrl,
    toggleTimer,
    followRoomCycle,
    runHostAction,
    addTask: addSessionTask,
    toggleTask,
    removeDoneTasks
  } = session
  const [relayDraft, setRelayDraft] = useState(snapshot.presenceRelayUrl)
  const {
    activeRoom,
    activeMode,
    roomCycle,
    level,
    activePeers,
    online,
    spaceOnline,
    remoteOnline,
    roomCapacityPercent,
    timerProgress,
    followingRoomCycle,
    completedTasks,
    openTasks,
    currentTask,
    userSeat,
    weeklyFocus,
    badges,
    roomMembers,
    roomMaxFocusSeconds,
    focusingCount,
    liveDeskMembers,
    inviteUrl,
    topicTail,
    relayHealthLabel,
    remoteHeartbeatLabel,
    remoteFreshValue,
    presenceProofRows,
    presenceProofText,
    presenceTtlSeconds,
    arrivalRosterMembers,
    roomEvents,
    recentLiveEvents,
    latestRemotePeer,
    connectionLabel,
    liveLineCode,
    liveLineText,
    liveLineMeta,
    liveLineClass,
    connectionDetail,
    liveSessionTitle,
    liveSessionDetail,
    inviteHint,
    spaceKindLabel,
    spaceOverviewKindLabel,
    stageStatusLabel,
    contractDisplay,
    hostActionLabel,
    hostActionKind,
    hostBrief,
    hostChecklist,
    roomFeed
  } = viewModel
  const hostActionIcon = hostActionKind === 'theater'
    ? <Maximize2 size={14} />
    : hostActionKind === 'lock'
      ? <Target size={14} />
      : hostActionKind === 'sync'
        ? <RefreshCw size={14} />
        : <Play size={14} />

  useEffect(() => {
    if (!focusTheaterOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFocusTheaterOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusTheaterOpen])

  const saveNickname = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    saveSessionNickname(nicknameDraft)
    setEditingName(false)
  }

  const joinSpace = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    joinSessionSpace(spaceDraft)
    setSpaceDraft('')
    setCopyState('idle')
  }

  const createSpace = (): void => {
    createSessionSpace()
    setSpaceDraft('')
    setCopyState('idle')
  }

  const saveRelayUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const relayUrl = saveSessionRelayUrl(relayDraft)
    setRelayDraft(relayUrl)
  }

  const resetRelayUrl = (): void => {
    setRelayDraft(STUDY_PRESENCE_BROKER_URL)
    resetSessionRelayUrl()
  }

  const copyInvite = async (): Promise<void> => {
    const text = `StudiumX 学习空间：${activeRoom.name}\n链接：${inviteUrl}\n空间码：${snapshot.spaceCode}\n进入后会加入同一学习空间；另开窗口或标签页会使用独立同桌身份。`
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2200)
    } catch {
      setCopyState('failed')
    }
  }

  const copyPresenceProof = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(presenceProofText)
      setProofCopyState('copied')
      window.setTimeout(() => setProofCopyState('idle'), 2200)
    } catch {
      setProofCopyState('failed')
    }
  }

  const openVerificationWindow = (): void => {
    const opened = window.open(studyVerificationUrl(inviteUrl), '_blank')
    if (opened) {
      opened.focus()
      setVerifyOpenState('opened')
      window.setTimeout(() => setVerifyOpenState('idle'), 2200)
    } else {
      setVerifyOpenState('blocked')
    }
  }

  const addTask = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (addSessionTask(taskInput)) setTaskInput('')
  }
  const roomBackdropStyle = {
    '--study-room-image': `url(${studyRoomAmbience})`
  } as CSSProperties
  return (
    <section
      className={`study-space ${activeRoom.backdrop}${snapshot.timerState === 'running' ? ' is-running' : ''}${snapshot.timerMode === 'break' ? ' is-break' : ''}`}
      style={roomBackdropStyle}
      aria-label="学习空间"
    >
      <div className="study-hero">
        <div className="study-hero-copy">
          <span className="study-eyebrow"><DoorOpen size={14} /> 学习空间</span>
          <h1>{activeRoom.name}</h1>
          <p>{activeRoom.tone}</p>
          <div className="study-hero-meta">
            <span className={`study-presence-pill is-${presence.status}`}>
              <span />
              {presence.status === 'online' ? `${online} 人在线` : presence.status === 'connecting' ? '连接学习空间' : '离线，仅本机'}
            </span>
            <span>空间 {snapshot.spaceCode}</span>
            <span>{activeRoom.light}</span>
            <span>{activeRoom.ambient}</span>
            <span>{presence.status === 'online' ? '实时同步' : presence.status === 'connecting' ? '连接同步' : '本机模式'}</span>
          </div>
          <div className={`study-hero-livebar is-${presence.status}${latestRemotePeer ? ' has-peer' : ''}`} aria-label="首屏实时状态">
            <span>{liveLineCode}</span>
            <strong>{liveLineText}</strong>
            <em>{liveLineMeta}</em>
            <div>
              <small>{focusingCount} 专注</small>
              <small>{remoteHeartbeatLabel}</small>
              <small>{online}/{activeRoom.capacity}</small>
            </div>
          </div>
        </div>
        <div className="study-header-stats" aria-label="学习统计">
          <span><Zap size={15} /> 连续 {snapshot.streakDays}</span>
          <span><Trophy size={15} /> 等级 {level.level}</span>
          <span><Target size={15} /> {completedTasks}/{snapshot.tasks.length}</span>
          <form className="study-hero-join" onSubmit={joinSpace}>
            <KeyRound size={14} />
            <input
              value={spaceDraft}
              onChange={(event) => setSpaceDraft(event.target.value)}
              placeholder="输入空间码"
              aria-label="加入在线自习空间码"
              maxLength={18}
            />
            <button type="submit">加入</button>
          </form>
        </div>
      </div>

      <StudyArrivalPanel
        activeRoom={activeRoom}
        snapshot={snapshot}
        presence={presence}
        roomCycleNow={roomCycleNow}
        roomCycle={roomCycle}
        online={online}
        spaceOnline={spaceOnline}
        remoteOnline={remoteOnline}
        roomCapacityPercent={roomCapacityPercent}
        focusingCount={focusingCount}
        remoteFreshValue={remoteFreshValue}
        arrivalRosterMembers={arrivalRosterMembers}
        latestRemotePeer={latestRemotePeer}
        liveLineCode={liveLineCode}
        liveLineText={liveLineText}
        liveLineMeta={liveLineMeta}
        liveSessionTitle={liveSessionTitle}
        liveSessionDetail={liveSessionDetail}
        relayHealthLabel={relayHealthLabel}
        contractDisplay={contractDisplay}
        topicTail={topicTail}
        presenceProofRows={presenceProofRows}
        inviteUrl={inviteUrl}
        inviteHint={inviteHint}
        spaceKindLabel={spaceKindLabel}
        relayDraft={relayDraft}
        copyState={copyState}
        proofCopyState={proofCopyState}
        verifyOpenState={verifyOpenState}
        onRelayDraftChange={setRelayDraft}
        onCreateSpace={createSpace}
        onCopyInvite={() => void copyInvite()}
        onCopyPresenceProof={() => void copyPresenceProof()}
        onOpenVerificationWindow={openVerificationWindow}
        onFollowRoomCycle={followRoomCycle}
        onOpenFocusTheater={() => setFocusTheaterOpen(true)}
        onSaveRelayUrl={saveRelayUrl}
        onResetRelayUrl={resetRelayUrl}
      />

      <div className="study-layout">
        <StudyRoomStage
          activeRoom={activeRoom}
          snapshot={snapshot}
          presence={presence}
          roomCycleNow={roomCycleNow}
          roomCycle={roomCycle}
          online={online}
          remoteOnline={remoteOnline}
          roomMaxFocusSeconds={roomMaxFocusSeconds}
          focusingCount={focusingCount}
          remoteHeartbeatLabel={remoteHeartbeatLabel}
          liveDeskMembers={liveDeskMembers}
          recentLiveEvents={recentLiveEvents}
          roomMembers={roomMembers}
          stageStatusLabel={stageStatusLabel}
          contractDisplay={contractDisplay}
          hostActionIcon={hostActionIcon}
          hostActionLabel={hostActionLabel}
          hostBrief={hostBrief}
          hostChecklist={hostChecklist}
          followingRoomCycle={followingRoomCycle}
          liveLineCode={liveLineCode}
          liveLineText={liveLineText}
          liveLineMeta={liveLineMeta}
          liveLineClass={liveLineClass}
          connectionLabel={connectionLabel}
          copyState={copyState}
          onRunHostAction={runHostAction}
          onFollowRoomCycle={followRoomCycle}
          onCopyInvite={() => void copyInvite()}
          onOpenFocusTheater={() => setFocusTheaterOpen(true)}
          onEditName={() => {
            setNicknameDraft(snapshot.nickname)
            setEditingName(true)
          }}
        />

        <StudyWorkPanels
          snapshot={snapshot}
          level={level}
          currentTask={currentTask}
          openTasks={openTasks}
          completedTasks={completedTasks}
          weeklyFocus={weeklyFocus}
          badges={badges}
          taskInput={taskInput}
          onTaskInputChange={setTaskInput}
          onAddTask={addTask}
          onToggleTask={toggleTask}
          onRemoveDoneTasks={removeDoneTasks}
        >

        <section className="study-panel study-companion-panel" aria-label="在线同学">
          <div className="study-panel-head">
            <div>
              <span className="study-kicker"><Coffee size={14} /> 同桌</span>
              <h2>真实在线</h2>
            </div>
            <span className={`study-relay-badge is-${presence.status}`}>{connectionLabel}</span>
          </div>
          <div className={`study-companion-hero is-${presence.status}`}>
            <div>
              <span>{presence.status === 'online' ? '在线空间' : presence.status === 'connecting' ? '正在入场' : '本机席位'}</span>
              <strong>{presence.status === 'online' ? `${online} 人在 ${activeRoom.name}` : presence.status === 'connecting' ? '连接同步服务' : '等待同桌加入'}</strong>
              <p>{remoteOnline > 0 ? `${remoteOnline} 位远端同学刚刚心跳，座位图和同桌列表会实时更新。` : presence.status === 'online' ? '复制邀请或打开验证窗口后，真实远端 session 才会进入这里。' : `先保留 ${formatStudySeatLabel(userSeat)}，连接恢复或同学进入后才会增加在线人数。`}</p>
            </div>
            <div>
              <button type="button" onClick={() => void copyInvite()}>
                <Copy size={13} />
                {copyState === 'copied' ? '已复制' : '复制邀请'}
              </button>
              <button type="button" onClick={openVerificationWindow} disabled={presence.status !== 'online'}>
                <ExternalLink size={13} />
                {remoteOnline > 0 ? '再开同桌' : '验证在线'}
              </button>
            </div>
          </div>
          <div className={`study-room-board is-${presence.status}${latestRemotePeer ? ' has-peer' : ''}`} aria-label="空间状态板">
            <div className="study-room-board-head">
              <span>{liveLineCode}</span>
              <div>
                <strong>{liveLineText}</strong>
                <small>{liveLineMeta}</small>
              </div>
            </div>
            <div className="study-room-board-grid">
              <div>
                <span>我的席位</span>
                <strong>{formatStudySeatLabel(userSeat)}</strong>
                <small>{studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)}</small>
              </div>
              <div>
                <span>远端心跳</span>
                <strong>{remoteFreshValue}</strong>
                <small>{formatStudyPresenceAge(presence.lastRemoteMessageAt, roomCycleNow)}</small>
              </div>
              <div>
                <span>空间容量</span>
                <strong>{online}/{activeRoom.capacity}</strong>
                <small>空间 {spaceOnline} 人</small>
              </div>
              <div>
                <span>同步空间</span>
                <strong>{snapshot.spaceCode}</strong>
                <small>{activeRoom.name} · {relayHealthLabel}</small>
              </div>
            </div>
            <div className="study-room-board-roster" aria-label="席位头像">
              {roomMembers.slice(0, 8).map((member) => (
                <span className={member.isSelf ? 'is-me' : ''} key={member.clientId} title={`${member.nickname} · ${formatStudySeatLabel(member.seatIndex)} · ${studyMemberFreshnessLabel(member, roomCycleNow)}`}>
                  {member.isSelf ? '我' : member.nickname.slice(0, 1).toUpperCase()}
                </span>
              ))}
              {remoteOnline === 0 ? <em>等待远端同桌</em> : null}
            </div>
          </div>
          <div className="study-classmate-list">
            <div className="study-classmate-head">
              <div>
                <span className="study-kicker"><Users size={14} /> 正在同桌</span>
                <strong>{remoteOnline === 0 ? '先显示你的真实席位' : `${remoteOnline} 位远端同学在场`}</strong>
              </div>
              <span>{connectionLabel}</span>
            </div>
            <div className="study-classmate-row is-me">
              <span>{snapshot.nickname.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{snapshot.nickname}</strong>
                <small>{formatStudySeatLabel(userSeat)} · {studySignalLabel(snapshot.signalId)} · {snapshot.timerMode === 'focus' ? `${snapshot.focusMinutes}m 专注` : '休息中'} · {contractDisplay} · 本机心跳</small>
              </div>
              <em>{studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)}</em>
            </div>
            {activePeers.length === 0 ? (
              <div className="study-empty-online">
                {presence.status === 'online' ? '当前空间还没有其他同学。打开另一个客户端或邀请朋友进入同一空间后，人数和座位才会增加。' : '正在连接学习空间，连接失败时不会显示模拟人数。'}
              </div>
            ) : activePeers.map((peer) => (
              <div className="study-classmate-row" key={peer.clientId}>
                <span>{peer.nickname.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{peer.nickname}</strong>
                  <small>{formatStudySeatLabel(normalizeStudySeatIndex(peer.seatIndex, peer.roomId, peer.clientId))} · {studySignalLabel(peer.signalId)} · {peer.timerMode === 'focus' ? `${peer.focusMinutes}m 专注` : '休息中'} · 连续 {peer.streakDays} · {studyMemberFreshnessLabel(peer, roomCycleNow)}</small>
                </div>
                <em>{studyMemberStatusLabel(peer.status, peer.timerMode)}</em>
              </div>
            ))}
          </div>
          <div className="study-room-actions" aria-label="空间互动">
            <button type="button" onClick={() => emitRoomEvent('checkin', `${snapshot.nickname} 在 ${activeRoom.name} 签到。`)}>
              <CheckCircle2 size={13} />
              签到
            </button>
            <button type="button" onClick={() => emitRoomEvent('cheer', `${snapshot.nickname} 给同桌们加油。`)}>
              <Zap size={13} />
              加油
            </button>
            <button type="button" onClick={() => emitRoomEvent('cheer', `${snapshot.nickname} 休息提醒：记得喝水和放松眼睛。`)}>
              <Coffee size={13} />
              休息提醒
            </button>
          </div>
          <div className="study-event-stream" aria-label="实时互动流">
            {roomEvents.length === 0 ? (
              <div className="study-event-empty">还没有实时互动。签到或开始专注后，同空间的同学会看到动态。</div>
            ) : roomEvents.map((event) => (
              <div className={`study-event-row is-${event.kind}`} key={event.id}>
                <span>{event.kind === 'checkin' ? 'IN' : event.kind === 'focus_start' ? 'GO' : event.kind === 'task_done' ? 'OK' : 'UP'}</span>
                <div>
                  <strong>{event.nickname}<small>{formatStudyEventTime(event.createdAt)}</small></strong>
                  <p>{event.text}</p>
                </div>
              </div>
            ))}
          </div>
          <details className="study-room-digest">
            <summary>
              <span><Info size={13} /> 学习摘要</span>
              <ChevronDown size={14} />
            </summary>
            <div className="study-room-feed" aria-label="学习动态">
              {roomFeed.map((item, index) => (
                <div key={index} className="study-feed-row">
                  <span>{index + 1}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </details>
          <div className="study-invite-note">
            <Info size={14} />
            <span>{connectionDetail}</span>
          </div>
          <div className="study-leaderboard" aria-label="本空间专注榜">
            <div className="study-leaderboard-head">
              <strong>本空间专注榜</strong>
              <span>{roomMembers.length} 人</span>
            </div>
            {roomMembers.slice(0, 5).map((member, index) => (
              <div className={`study-leader-row${member.isSelf ? ' is-me' : ''}`} key={member.clientId}>
                <span>{index + 1}</span>
                <strong>{member.nickname}</strong>
                <em>{studySignalShortLabel(member.signalId)} · {formatStudyHours(member.todayFocusSeconds)}h · {studyMemberFreshnessLabel(member, roomCycleNow)}</em>
              </div>
            ))}
          </div>
          <details className="study-live-proof" aria-label="在线同步证明">
            <summary>
              <span><GitBranch size={13} /> 在线来源</span>
              <ChevronDown size={14} />
            </summary>
            <div className="study-live-proof-head">
              <div>
                <strong>{presence.topic}</strong>
              </div>
              <div className="study-live-proof-actions">
                <button type="button" onClick={openVerificationWindow}>
                  <ExternalLink size={13} />
                  {verifyOpenState === 'opened' ? '已打开' : verifyOpenState === 'blocked' ? '被拦截' : '打开验证窗口'}
                </button>
                <button type="button" onClick={() => void copyPresenceProof()}>
                  <Copy size={13} />
                  {proofCopyState === 'copied' ? '已复制' : proofCopyState === 'failed' ? '复制失败' : '复制证明'}
                </button>
              </div>
            </div>
            <div className="study-live-proof-grid">
              {presenceProofRows.map((row) => (
                <div key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
            <p>人数只来自当前 topic 的 MQTT 心跳；每个窗口使用独立 session presence 身份，超过 {presenceTtlSeconds} 秒未心跳会自动下线。</p>
          </details>
        </section>

        </StudyWorkPanels>
      </div>

      <div className="study-space-overview" aria-label="空间概览">
        <div>
          <span>空间类型</span>
          <strong>{spaceOverviewKindLabel}</strong>
        </div>
        <div>
          <span>当前模式</span>
          <strong>{activeMode.name}</strong>
        </div>
        <div>
          <span>当前目标</span>
          <strong>{contractDisplay}</strong>
        </div>
        <div>
          <span>学习节奏</span>
          <strong>{roomCycle.phase === 'focus' ? '专注中' : '休息中'} · {formatStudyDuration(roomCycle.remainingSeconds)}</strong>
        </div>
        <div>
          <span>实时人数</span>
          <strong>{presence.status === 'online' ? `${online} / ${activeRoom.capacity}` : '离线'}</strong>
        </div>
      </div>
      {focusTheaterOpen ? (
        <div className={`study-theater is-${snapshot.timerMode}`} role="dialog" aria-modal="true" aria-label="沉浸专注视图">
          <div className="study-theater-surface">
            <div className="study-theater-topbar">
              <div>
                <span className={`study-presence-pill is-${presence.status}`}>
                  <span />
                  {presence.status === 'online' ? `${online} 人在线` : presence.status === 'connecting' ? '连接中' : '离线'}
                </span>
                <strong>{activeRoom.name}</strong>
              </div>
              <button type="button" aria-label="关闭沉浸视图" onClick={() => setFocusTheaterOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="study-theater-center">
              <span>{snapshot.timerMode === 'focus' ? '专注中' : '恢复中'}</span>
              <strong>{formatStudyDuration(snapshot.remainingSeconds)}</strong>
              <p>{contractDisplay}</p>
              <div className="study-theater-host">
                {hostChecklist.map((item) => (
                  <span key={item.label}><em>{item.label}</em>{item.value}</span>
                ))}
              </div>
              <div className="study-theater-progress" aria-hidden="true">
                <span style={{ width: `${timerProgress}%` }} />
              </div>
            </div>
            <div className="study-theater-bottom">
              <div className="study-theater-cycle">
                <span>第 {roomCycle.round} 轮</span>
                <strong>{roomCycle.phase === 'focus' ? '同频专注' : '同步休息'} · {formatStudyDuration(roomCycle.remainingSeconds)}</strong>
              </div>
              <div className="study-theater-peers" aria-label="在线同桌">
                {roomMembers.slice(0, 6).map((member) => (
                  <span className={member.isSelf ? 'is-me' : ''} key={member.clientId} title={`${formatStudySeatLabel(member.seatIndex)} · ${member.nickname} · ${studySignalLabel(member.signalId)} · ${studyMemberStatusLabel(member.status, member.timerMode)} · ${studyMemberFreshnessLabel(member, roomCycleNow)}`}>
                    {studySignalShortLabel(member.signalId)}
                  </span>
                ))}
              </div>
              <div className="study-theater-actions">
                <button type="button" onClick={toggleTimer}>
                  {snapshot.timerState === 'running' ? <Pause size={15} /> : <Play size={15} />}
                  {snapshot.timerState === 'running' ? '暂停' : '开始'}
                </button>
                <button type="button" onClick={followRoomCycle}>同步节奏</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {editingName ? (
        <div className="study-name-modal-backdrop" role="presentation" onClick={() => setEditingName(false)}>
          <form className="study-name-modal" onSubmit={saveNickname} onClick={(event) => event.stopPropagation()}>
            <h2>在线身份</h2>
            <p>这个昵称只用于学习空间在线心跳，不会上传任务内容。</p>
            <input value={nicknameDraft} onChange={(event) => setNicknameDraft(event.target.value)} maxLength={18} autoFocus />
            <div>
              <button className="ghost-button" type="button" onClick={() => setEditingName(false)}>取消</button>
              <button className="primary-button" type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  )
}
