import { describe, expect, it } from 'vitest'
import {
  cancelPetDrag,
  clampAssistantDialogGeometry,
  clampPetContextMenuPlacement,
  clampPetPlacement,
  clampPetSize,
  defaultAssistantDialogGeometry,
  derivePetAttention,
  finishPetDrag,
  finishPetResize,
  movePetDrag,
  movePetResize,
  parseStoredAssistantDialogGeometry,
  parseStoredPetPlacement,
  petSurfaceSize,
  projectAssistantDialogInteraction,
  resolvePetActivityFocusAfterRemoval,
  resolvePetActivityNavigation,
  resolvePetBubbleLayout,
  shouldDismissPetContextMenu,
  shouldRestorePetFocusAfterContextMenuDismissal,
  startAssistantDialogInteraction,
  startPetDrag,
  startPetResize
} from '../../src/renderer/src/views/pet/pet-interaction'

const desktop = { width: 1_000, height: 800 }

describe('pet-interaction contract', () => {
  it('accepts only finite persisted placements and assistant geometry', () => {
    expect(parseStoredPetPlacement('{"x":20,"y":30}')).toEqual({ x: 20, y: 30 })
    expect(parseStoredPetPlacement('{"x":null,"y":30}')).toBeNull()
    expect(parseStoredPetPlacement('{"x":1e999,"y":30}')).toBeNull()
    expect(parseStoredPetPlacement('{not json')).toBeNull()

    expect(parseStoredAssistantDialogGeometry('{"x":20,"y":30,"width":380,"height":560}')).toEqual({
      x: 20,
      y: 30,
      width: 380,
      height: 560
    })
    expect(parseStoredAssistantDialogGeometry('{"x":20,"y":30,"width":"380","height":560}')).toBeNull()
  })

  it('keeps floating placements reachable in regular and undersized viewports', () => {
    expect(clampPetPlacement({ x: 980, y: 790 }, desktop, { width: 150, height: 130 })).toEqual({
      x: 836,
      y: 656
    })
    expect(clampPetPlacement({ x: -20, y: -10 }, { width: 80, height: 60 }, { width: 150, height: 130 })).toEqual({
      x: 14,
      y: 14
    })
    expect(clampPetContextMenuPlacement({ x: 990, y: 790 }, desktop)).toEqual({ x: 796, y: 600 })
  })

  it('keeps Pet bubbles inside left and right viewport edges without moving the Pet anchor', () => {
    const viewport = { width: 320, height: 480 }
    const bubble = { width: 240, height: 120 }

    const left = resolvePetBubbleLayout({ x: 4, y: 220, width: 112, height: 121 }, bubble, viewport)
    expect(left).toMatchObject({ x: 12, horizontal: 'start', vertical: 'above' })
    expect(left.x + left.width).toBeLessThanOrEqual(viewport.width - 12)

    const right = resolvePetBubbleLayout({ x: 250, y: 220, width: 112, height: 121 }, bubble, viewport)
    expect(right).toMatchObject({ x: 68, horizontal: 'end', vertical: 'above' })
    expect(right.x + right.width).toBeLessThanOrEqual(viewport.width - 12)
  })

  it('flips a Pet bubble below the mascot when the upper viewport cannot contain it', () => {
    expect(resolvePetBubbleLayout(
      { x: 160, y: 8, width: 112, height: 121 },
      { width: 240, height: 180 },
      { width: 640, height: 480 }
    )).toMatchObject({ y: 137, vertical: 'below', maxHeight: 456 })
  })

  it('keeps oversized activity bubbles usable in tiny viewports with an internal height budget', () => {
    const layout = resolvePetBubbleLayout(
      { x: 40, y: 40, width: 112, height: 121 },
      { width: 360, height: 520 },
      { width: 180, height: 160 }
    )

    expect(layout).toMatchObject({ x: 12, y: 12, width: 156, maxHeight: 136 })
    expect(layout.x + layout.width).toBe(168)
    expect(layout.y + layout.height).toBe(148)
  })

  it('navigates activity identities cyclically and preserves the nearest notification after removal', () => {
    const ids = ['waiting:ask-1', 'failed:run-1', 'running:run-2']
    expect(resolvePetActivityNavigation(ids, 'waiting:ask-1', 'ArrowDown')).toBe('failed:run-1')
    expect(resolvePetActivityNavigation(ids, 'waiting:ask-1', 'ArrowUp')).toBe('running:run-2')
    expect(resolvePetActivityNavigation(ids, 'failed:run-1', 'Home')).toBe('waiting:ask-1')
    expect(resolvePetActivityNavigation(ids, 'failed:run-1', 'End')).toBe('running:run-2')
    expect(resolvePetActivityFocusAfterRemoval(ids, ['waiting:ask-1', 'running:run-2'], 'failed:run-1'))
      .toBe('running:run-2')
    expect(resolvePetActivityFocusAfterRemoval(ids, ['waiting:ask-1'], 'running:run-2'))
      .toBe('waiting:ask-1')
  })

  it('distinguishes a click activation from a moved drag that persists placement', () => {
    const drag = startPetDrag(4, { x: 100, y: 100 }, { x: 200, y: 300 })
    const pending = movePetDrag(drag, 4, { x: 102, y: 102 }, desktop, { width: 150, height: 130 })

    expect(pending.placement).toBeNull()
    expect(finishPetDrag(pending.session, 4)).toBe('activate-assistant')

    const moving = movePetDrag(pending.session, 4, { x: -100, y: 600 }, desktop, { width: 150, height: 130 })
    expect(moving).toMatchObject({
      placement: { x: 14, y: 656 },
      direction: 'left'
    })
    expect(finishPetDrag(moving.session, 4)).toBe('persist-placement')
    expect(finishPetDrag(moving.session, 8)).toBe('ignore')
  })

  it('tracks instantaneous drag direction and never activates the assistant on pointer cancellation', () => {
    const drag = startPetDrag(7, { x: 100, y: 100 }, { x: 200, y: 300 })
    const movingRight = movePetDrag(drag, 7, { x: 130, y: 100 }, desktop, { width: 150, height: 130 })
    expect(movingRight.direction).toBe('right')

    const reversingBeforeTheStartPoint = movePetDrag(
      movingRight.session,
      7,
      { x: 120, y: 100 },
      desktop,
      { width: 150, height: 130 }
    )
    expect(reversingBeforeTheStartPoint.direction).toBe('left')
    expect(cancelPetDrag(reversingBeforeTheStartPoint.session, 7)).toBe('persist-placement')

    const click = startPetDrag(8, { x: 10, y: 10 }, { x: 20, y: 20 })
    expect(cancelPetDrag(click, 8)).toBe('cancel-activation')
  })

  it('clamps and persists pet resizing within the Codex sprite width contract', () => {
    expect(clampPetSize(60)).toBe(80)
    expect(clampPetSize(300)).toBe(224)
    expect(clampPetSize(Number.NaN)).toBe(112)
    expect(petSurfaceSize(112)).toEqual({ width: 124, height: 133 })

    const resize = startPetResize(9, 200, 112)
    const growing = movePetResize(resize, 9, 150)
    expect(growing.size).toBe(162)
    expect(finishPetResize(growing.session, 9)).toEqual({ outcome: 'persist-size', size: 162 })

    const clamped = movePetResize(growing.session, 9, -100)
    expect(clamped.size).toBe(224)
    expect(movePetResize(clamped.session, 10, 0).size).toBeNull()
    expect(finishPetResize(resize, 9)).toEqual({ outcome: 'no-change', size: 112 })
  })

  it('uses established attention precedence and limits hover animation to idle', () => {
    expect(derivePetAttention({
      notificationState: 'waiting',
      hovered: true,
      dragDirection: null,
      showStatusBubble: true
    })).toEqual({ baseState: 'waiting', visualState: 'waiting', showBubble: true })

    expect(derivePetAttention({
      notificationState: 'failed',
      hovered: true,
      dragDirection: 'left',
      showStatusBubble: true
    })).toEqual({ baseState: 'failed', visualState: 'running-left', showBubble: true })

    expect(derivePetAttention({
      notificationState: null,
      hovered: true,
      dragDirection: null,
      showStatusBubble: true
    })).toEqual({ baseState: 'idle', visualState: 'jumping', showBubble: false })
  })

  it('models context-menu dismissal without browser event dependencies', () => {
    expect(shouldDismissPetContextMenu({ reason: 'outside-pointer', pointerIsInsideMenu: true })).toBe(false)
    expect(shouldDismissPetContextMenu({ reason: 'outside-pointer', pointerIsInsideMenu: false })).toBe(true)
    expect(shouldDismissPetContextMenu({ reason: 'scroll' })).toBe(true)
    expect(shouldRestorePetFocusAfterContextMenuDismissal('escape')).toBe(true)
    expect(shouldRestorePetFocusAfterContextMenuDismissal('window-blur')).toBe(false)
  })

  it('projects assistant drag and resize geometry through the same viewport policy', () => {
    expect(defaultAssistantDialogGeometry(desktop)).toEqual({ x: 604, y: 224, width: 380, height: 560 })
    expect(clampAssistantDialogGeometry({ x: 900, y: 700, width: 800, height: 700 }, desktop)).toEqual({
      x: 184,
      y: 84,
      width: 800,
      height: 700
    })

    const resize = startAssistantDialogInteraction({
      pointerId: 12,
      mode: 'resize',
      direction: 'nw',
      startPoint: { x: 400, y: 300 },
      startGeometry: { x: 400, y: 300, width: 380, height: 560 }
    })
    expect(projectAssistantDialogInteraction(resize, 12, { x: 700, y: 800 }, desktop)).toEqual({
      x: 480,
      y: 464,
      width: 300,
      height: 320
    })
    expect(projectAssistantDialogInteraction(resize, 13, { x: 700, y: 800 }, desktop)).toBeNull()

    expect(clampAssistantDialogGeometry(
      { x: 900, y: 700, width: 800, height: 700 },
      { width: 180, height: 160 }
    )).toEqual({ x: 16, y: 16, width: 148, height: 128 })
  })
})
