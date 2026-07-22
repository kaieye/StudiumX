import { describe, expect, it, vi } from 'vitest'
import {
  applyLifecycleNotificationDecision,
  decideAndApplyLifecycleNotification,
  decideLifecycleNotification,
  inferNotificationEvent,
  mapSystemNotificationPermission,
  readBrowserNotificationPermission,
  resolveNotificationHostPolicyInput
} from '../../src/renderer/src/study-space/planning-notification-host'

describe('planning-notification-host (STC-601/602/605 product path)', () => {
  it('inferNotificationEvent classifies break end cues', () => {
    expect(inferNotificationEvent({ title: '休息结束', body: '' })).toBe('break_end')
    expect(inferNotificationEvent({ title: 'Break done', body: '' })).toBe('break_end')
    expect(inferNotificationEvent({ title: '进入休息', body: '开始休息' })).toBe('focus_end')
    expect(inferNotificationEvent({ title: '专注完成', body: '该休息了' })).toBe('focus_end')
  })

  it('mapSystemNotificationPermission maps browser strings', () => {
    expect(mapSystemNotificationPermission('granted')).toBe('granted')
    expect(mapSystemNotificationPermission('denied')).toBe('denied')
    expect(mapSystemNotificationPermission('default')).toBe('default')
    expect(mapSystemNotificationPermission(null)).toBe('unsupported')
    expect(mapSystemNotificationPermission('weird')).toBe('unsupported')
  })

  it('readBrowserNotificationPermission uses injected global', () => {
    expect(readBrowserNotificationPermission({ permission: 'granted' })).toBe('granted')
    expect(readBrowserNotificationPermission(null)).toBe('unsupported')
  })

  it('resolveNotificationHostPolicyInput ORs quietUntil + master off into DND', () => {
    const fromQuiet = resolveNotificationHostPolicyInput({
      quietUntilMs: 10_000,
      nowMs: 5_000,
      notificationsEnabled: true,
      fullscreen: false,
      systemPermission: 'granted'
    })
    expect(fromQuiet.doNotDisturb).toBe(true)

    const fromMasterOff = resolveNotificationHostPolicyInput({
      notificationsEnabled: false,
      quietUntilMs: null,
      nowMs: 5_000,
      systemPermission: 'granted'
    })
    expect(fromMasterOff.doNotDisturb).toBe(true)

    const clear = resolveNotificationHostPolicyInput({
      notificationsEnabled: true,
      quietUntilMs: 1_000,
      nowMs: 5_000,
      systemPermission: 'default',
      fullscreen: true
    })
    expect(clear.doNotDisturb).toBe(false)
    expect(clear.fullscreen).toBe(true)
    expect(clear.systemPermission).toBe('default')
  })

  it('decideLifecycleNotification DND keeps in-app, suppresses system+sound', () => {
    const d = decideLifecycleNotification(
      { kind: 'notification', title: '专注结束', body: '可以短暂离开' },
      { doNotDisturb: true, systemPermission: 'granted', fullscreen: false }
    )
    expect(d.shouldShowInApp).toBe(true)
    expect(d.trySystemNotification).toBe(false)
    expect(d.playSound).toBe(false)
    expect(d.event).toBe('focus_end')
  })

  it('decideLifecycleNotification fullscreen suppresses system+sound', () => {
    const d = decideLifecycleNotification(
      { kind: 'notification', title: '专注结束', body: '' },
      { fullscreen: true, systemPermission: 'granted', doNotDisturb: false }
    )
    expect(d.shouldShowInApp).toBe(true)
    expect(d.trySystemNotification).toBe(false)
    expect(d.playSound).toBe(false)
  })

  it('decideAndApplyLifecycleNotification delivers in-app under quiet mode', () => {
    const show = vi.fn()
    const result = decideAndApplyLifecycleNotification({
      intent: { kind: 'notification', title: '休息结束', body: '继续专注' },
      live: {
        quietUntilMs: 99_000,
        nowMs: 1_000,
        notificationsEnabled: true,
        systemPermission: 'granted',
        fullscreen: false
      },
      showInApp: show
    })
    expect(result.decision.event).toBe('break_end')
    expect(result.decision.reason).toBe('do_not_disturb')
    expect(result.deliveredInApp).toBe(true)
    expect(show).toHaveBeenCalledWith('休息结束', '继续专注')
  })

  it('applyLifecycleNotificationDecision skips when showInApp false', () => {
    const show = vi.fn()
    const delivered = applyLifecycleNotificationDecision({
      intent: { kind: 'notification', title: 'x', body: 'y' },
      decision: {
        showInApp: false,
        trySystemNotification: false,
        playSound: false,
        reason: 'event_disabled_in_policy',
        shouldShowInApp: false
      },
      showInApp: show
    })
    expect(delivered.deliveredInApp).toBe(false)
    expect(show).not.toHaveBeenCalled()
  })
})
