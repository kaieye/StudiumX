import { CornerDownLeft, DoorOpen, Shuffle } from 'lucide-react'
import { useState, type FormEvent } from 'react'

type WorkbenchRoomSwitcherProps = {
  onEnterRandomSpace: () => void
  onJoinSpace: (spaceCode: string) => void
}

export function WorkbenchRoomSwitcher({
  onEnterRandomSpace,
  onJoinSpace
}: WorkbenchRoomSwitcherProps) {
  const [joinDraft, setJoinDraft] = useState('')

  const handleJoin = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!joinDraft.trim()) return
    onJoinSpace(joinDraft)
    setJoinDraft('')
  }

  return (
    <div className="workbench-leaderboard-actions" role="group" aria-label="自习室操作">
      <form className="workbench-room-join" onSubmit={handleJoin}>
        <DoorOpen size={15} aria-hidden="true" />
        <input
          value={joinDraft}
          onChange={(event) => setJoinDraft(event.target.value.toUpperCase())}
          placeholder="输入房间码"
          aria-label="输入要加入的房间码"
          maxLength={18}
        />
        <button
          className="workbench-room-enter-key"
          type="submit"
          disabled={!joinDraft.trim()}
          aria-label="加入房间"
          title="加入房间"
        >
          <CornerDownLeft size={16} aria-hidden="true" />
        </button>
      </form>

      <button
        className="workbench-room-random"
        type="button"
        onClick={onEnterRandomSpace}
        aria-label="随机进入自习室"
        title="随机进入自习室"
      >
        <Shuffle size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
