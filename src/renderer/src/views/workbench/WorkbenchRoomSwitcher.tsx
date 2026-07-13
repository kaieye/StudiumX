import { DoorOpen, Shuffle } from 'lucide-react'
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
      <button className="workbench-room-random" type="button" onClick={onEnterRandomSpace}>
        <Shuffle size={15} />
        <span>随机进入自习室</span>
      </button>

      <form className="workbench-room-join" onSubmit={handleJoin}>
        <DoorOpen size={15} />
        <input
          value={joinDraft}
          onChange={(event) => setJoinDraft(event.target.value.toUpperCase())}
          placeholder="输入房间码"
          aria-label="输入要加入的房间码"
          maxLength={18}
        />
        <button type="submit" disabled={!joinDraft.trim()}>加入房间</button>
      </form>
    </div>
  )
}
