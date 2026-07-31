import { CornerDownLeft, DoorOpen, Shuffle } from 'lucide-react'
import { useState, type FormEvent } from 'react'

type WorkbenchRoomSwitcherProps = {
  onEnterRandomSpace: () => void
  /** Resolves true only after the server confirms the room is currently active. */
  onJoinSpace: (spaceCode: string) => Promise<boolean>
}

export function WorkbenchRoomSwitcher({
  onEnterRandomSpace,
  onJoinSpace
}: WorkbenchRoomSwitcherProps) {
  const [joinDraft, setJoinDraft] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)

  const handleJoin = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!joinDraft.trim()) return
    const joined = await onJoinSpace(joinDraft)
    if (joined) {
      setJoinDraft('')
      setJoinError(null)
      return
    }
    setJoinError('未找到可加入的在线自习室，请检查房间码。')
  }

  return (
    <div className="workbench-leaderboard-actions" role="group" aria-label="自习室操作">
      <form className="workbench-room-join" onSubmit={handleJoin}>
        <DoorOpen size={15} aria-hidden="true" />
        <input
          value={joinDraft}
          onChange={(event) => {
            setJoinDraft(event.target.value.toUpperCase())
            setJoinError(null)
          }}
          placeholder="搜索现有房间码"
          aria-label="搜索要加入的现有房间码"
          maxLength={5}
        />
        <button
          className="workbench-room-enter-key"
          type="submit"
          disabled={!joinDraft.trim()}
          aria-label="搜索并加入现有房间"
          title="搜索并加入现有房间"
        >
          <CornerDownLeft size={16} aria-hidden="true" />
        </button>
      </form>
      <button
        className="workbench-room-random"
        type="button"
        onClick={onEnterRandomSpace}
        aria-label="随机分配新自习室"
        title="随机分配新自习室"
      >
        <Shuffle size={18} aria-hidden="true" />
      </button>
      {joinError ? <p className="workbench-room-join-error" role="alert">{joinError}</p> : null}
    </div>
  )
}
