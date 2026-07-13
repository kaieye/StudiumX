import { beforeEach, describe, expect, it } from 'vitest'
import {
  LEGACY_STUDY_SPACE_SESSION_CLIENT_KEY,
  LEGACY_STUDY_SPACE_STORAGE_KEY,
  STUDY_SPACE_SESSION_CLIENT_KEY,
  STUDY_SPACE_STORAGE_KEY,
  defaultStudySnapshot
} from '../../src/renderer/src/study-space/constants'
import {
  applyStudyInviteParams,
  readStudySnapshot,
  syncStudyLocation
} from '../../src/renderer/src/study-space/session/session-snapshot'

describe('durable Study Session snapshot', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('migrates a legacy snapshot and legacy tab identity into canonical storage', () => {
    window.localStorage.setItem(LEGACY_STUDY_SPACE_STORAGE_KEY, JSON.stringify({
      ...defaultStudySnapshot,
      clientId: 'studiumx-persisted',
      nickname: '专注同学',
      spaceCode: 'legacy room',
      roomId: 'sprint',
      focusMinutes: 45,
      breakMinutes: 10,
      remainingSeconds: 2_700
    }))
    window.sessionStorage.setItem(LEGACY_STUDY_SPACE_SESSION_CLIENT_KEY, 'studiumx-legacy-tab')

    const snapshot = readStudySnapshot()
    const persisted = JSON.parse(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY) ?? 'null')

    expect(snapshot).toMatchObject({
      clientId: 'studiumx-legacy-tab',
      nickname: '专注同学',
      spaceCode: 'LEGACYROOM',
      roomId: 'sprint'
    })
    expect(window.sessionStorage.getItem(STUDY_SPACE_SESSION_CLIENT_KEY)).toBe('studiumx-legacy-tab')
    expect(persisted).toMatchObject({
      clientId: 'studiumx-legacy-tab',
      spaceCode: 'LEGACYROOM',
      roomId: 'sprint'
    })
  })

  it('recovers from malformed stored JSON and overwrites it with a normalized snapshot', () => {
    window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, '{not valid JSON')
    window.sessionStorage.setItem(STUDY_SPACE_SESSION_CLIENT_KEY, 'studiumx-stable-tab')

    const snapshot = readStudySnapshot()
    const persisted = JSON.parse(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY) ?? 'null')

    expect(snapshot.clientId).toBe('studiumx-stable-tab')
    expect(snapshot.spaceCode).toBe(defaultStudySnapshot.spaceCode)
    expect(snapshot.tasks).toEqual(defaultStudySnapshot.tasks)
    expect(persisted).toEqual(snapshot)
  })

  it('lets canonical invite parameters override legacy aliases and persisted state', () => {
    window.history.replaceState(
      null,
      '',
      '/?studySpace=canonical-room&space=legacy-room&studyRoom=deep&room=exam'
    )

    const invited = applyStudyInviteParams({
      ...defaultStudySnapshot,
      clientId: 'studiumx-invite-test',
      spaceCode: 'PERSISTED',
      roomId: 'silent',
      focusMinutes: 25,
      breakMinutes: 5,
      remainingSeconds: 1_500
    })

    expect(invited).toMatchObject({
      spaceCode: 'CANONICAL-ROOM',
      roomId: 'deep',
      focusMinutes: 90,
      breakMinutes: 15,
      remainingSeconds: 5_400,
      timerMode: 'focus'
    })
  })

  it('reuses the session client identity instead of the persisted client identity', () => {
    window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify({
      ...defaultStudySnapshot,
      clientId: 'studiumx-old-client',
      nickname: '同学 IENT'
    }))
    window.sessionStorage.setItem(STUDY_SPACE_SESSION_CLIENT_KEY, 'studiumx-reused-ABCD')

    const first = readStudySnapshot()
    const second = readStudySnapshot()

    expect(first.clientId).toBe('studiumx-reused-ABCD')
    expect(first.nickname).toBe('同学 ABCD')
    expect(second.clientId).toBe(first.clientId)
    expect(JSON.parse(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY) ?? 'null').clientId).toBe(first.clientId)
  })

  it('synchronizes a canonical invite URL while preserving unrelated query and hash state', () => {
    window.history.replaceState(null, '', '/study?space=old&room=deep&studyFreshSession=1&source=share#focus')

    syncStudyLocation('team room', 'exam')

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/study?source=share&studySpace=TEAMROOM&studyRoom=exam#focus'
    )
  })
})