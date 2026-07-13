import { describe, expect, it } from 'vitest'
import {
  clampAssistantDialogGeometry,
  clampPetContextMenuPlacement,
  clampPetPlacement,
  defaultAssistantDialogGeometry,
  derivePetAttention,
  finishPetDrag,
  movePetDrag,
  parseStoredAssistantDialogGeometry,
  parseStoredPetPlacement,
  projectAssistantDialogInteraction,
  shouldDismissPetContextMenu,
  shouldRestorePetFocusAfterContextMenuDismissal,
  startAssistantDialogInteraction,
  startPetDrag
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
    expect(clampPetContextMenuPlacement({ x: 990, y: 790 }, desktop)).toEqual({ x: 820, y: 744 })
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

  it('uses established attention precedence and limits hover animation to idle', () => {
    expect(derivePetAttention({
      waiting: true,
      failed: true,
      reviewVisible: true,
      busy: true,
      introVisible: true,
      hovered: true,
      dragDirection: null,
      showStatusBubble: true
    })).toEqual({ baseState: 'waiting', visualState: 'waiting', showBubble: true })

    expect(derivePetAttention({
      waiting: false,
      failed: false,
      reviewVisible: false,
      busy: false,
      introVisible: false,
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
  })
})