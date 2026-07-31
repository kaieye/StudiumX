import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOfficeSceneRuntime,
  type OfficeSceneSeatOccupant,
  type OfficeSceneSeatState
} from '../../src/renderer/src/views/workbench/office-scene-runtime'

type FrameQueue = Map<number, FrameRequestCallback>

type RuntimeHarness = {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  frames: FrameQueue
  runtime: ReturnType<typeof createOfficeSceneRuntime>
}

function seatState({
  userSeatIndex = 0,
  occupantsByDeskId = new Map<`desk-${number}`, OfficeSceneSeatOccupant>()
}: Partial<OfficeSceneSeatState> = {}): OfficeSceneSeatState {
  return {
    userSeatIndex,
    activeRoomName: '深度自习室',
    connectionLabel: '已连接',
    cycleLabel: '专注中 · 25:00',
    occupantsByDeskId
  }
}

function installImageLoader(fail = false): void {
  class FakeImage {
    onload: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null

    set src(_value: string) {
      queueMicrotask(() => {
        const event = new Event(fail ? 'error' : 'load')
        if (fail) this.onerror?.(event)
        else this.onload?.(event)
      })
    }
  }

  vi.stubGlobal('Image', FakeImage)
}

function installMatchMedia(matches = false): void {
  const mediaQuery = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true)
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => mediaQuery)
  })
}

function createContext(): CanvasRenderingContext2D {
  return {
    arcTo: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 48 })),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    fillStyle: '',
    font: '',
    lineWidth: 1,
    strokeStyle: '',
    textAlign: 'start',
    textBaseline: 'alphabetic'
  } as unknown as CanvasRenderingContext2D
}

function createHarness({ reducedMotion = false, failedAssets = false } = {}): RuntimeHarness {
  installImageLoader(failedAssets)
  installMatchMedia(reducedMotion)
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn()
    observe = vi.fn()
    unobserve = vi.fn()
  })

  const frames: FrameQueue = new Map()
  let nextFrameId = 1
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const frameId = nextFrameId++
    frames.set(frameId, callback)
    return frameId
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((frameId: number) => frames.delete(frameId)))

  const stage = document.createElement('div')
  const canvas = document.createElement('canvas')
  stage.append(canvas)
  document.body.append(stage)
  Object.defineProperties(stage, {
    clientWidth: { configurable: true, value: 1_200 },
    clientHeight: { configurable: true, value: 900 }
  })
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
    bottom: 900,
    height: 900,
    left: 0,
    right: 1_200,
    top: 0,
    width: 1_200,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect)
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    bottom: 896,
    height: 896,
    left: 0,
    right: 1_088,
    top: 0,
    width: 1_088,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect)

  const context = createContext()
  vi.spyOn(canvas, 'getContext').mockReturnValue(context)
  const runtime = createOfficeSceneRuntime({
    stage,
    canvas,
    petAppearance: 'boba'
  })

  return { canvas, context, frames, runtime }
}

async function settleAssetLoad(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
}

function renderNextFrame(harness: RuntimeHarness, time: number): void {
  const next = harness.frames.entries().next().value as [number, FrameRequestCallback] | undefined
  expect(next).toBeDefined()
  const [frameId, render] = next!
  harness.frames.delete(frameId)
  render(time)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfficeSceneRuntime', () => {
  it('keeps desk clicks and keyboard events inert because seats are system assigned', async () => {
    const harness = createHarness()
    harness.runtime.mount()
    harness.runtime.update(seatState({
      occupantsByDeskId: new Map([
        ['desk-2', { kind: 'peer', name: '林同学', status: 'running', timerMode: 'focus', todayFocusSeconds: 1_500 }]
      ])
    }))
    await settleAssetLoad()

    const keyEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' })
    harness.canvas.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 140 }))
    harness.canvas.dispatchEvent(keyEvent)

    expect(keyEvent.defaultPrevented).toBe(false)
    expect(harness.canvas.style.cursor).not.toBe('pointer')
    harness.runtime.dispose()
  })

  it('draws each occupant today-focus duration above the seat in hours', async () => {
    const harness = createHarness()
    harness.runtime.mount()
    harness.runtime.update(seatState({
      occupantsByDeskId: new Map([
        ['desk-1', { kind: 'self', name: '我', status: 'running', timerMode: 'focus', todayFocusSeconds: 1_500 }]
      ])
    }))
    await settleAssetLoad()
    renderNextFrame(harness, 480)

    expect(vi.mocked(harness.context.fillText)).toHaveBeenCalledWith('今日 0.4h', expect.any(Number), expect.any(Number))
    harness.runtime.dispose()
  })

  it('does not draw a rectangular highlight around the current user desk', async () => {
    const harness = createHarness()
    harness.runtime.mount()
    harness.runtime.update(seatState({
      occupantsByDeskId: new Map([
        ['desk-1', { kind: 'self', name: '我', status: 'running', timerMode: 'focus', todayFocusSeconds: 1_500 }]
      ])
    }))
    await settleAssetLoad()
    renderNextFrame(harness, 480)

    expect(vi.mocked(harness.context.stroke)).not.toHaveBeenCalled()
    harness.runtime.dispose()
  })

  it('removes pending frame work on dispose without canvas interaction listeners', async () => {
    const harness = createHarness()
    harness.runtime.mount()
    await settleAssetLoad()

    expect(harness.frames).toHaveLength(1)
    harness.runtime.dispose()
    harness.canvas.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 140 }))

    expect(harness.frames).toHaveLength(0)
    expect(cancelAnimationFrame).toHaveBeenCalledOnce()
  })

  it('reports failed asset loading without starting a frame loop', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const harness = createHarness({ failedAssets: true })
    harness.runtime.mount()
    await settleAssetLoad()

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load StudiumX workbench assets',
      expect.any(Event)
    )
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    harness.runtime.dispose()
  })

  it('maintains exactly one pending animation frame when mount is called repeatedly', async () => {
    const harness = createHarness()
    harness.runtime.mount()
    harness.runtime.mount()
    await settleAssetLoad()

    expect(requestAnimationFrame).toHaveBeenCalledOnce()
    expect(harness.frames).toHaveLength(1)

    renderNextFrame(harness, 480)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2)
    expect(harness.frames).toHaveLength(1)
    harness.runtime.dispose()
  })

  it('uses the reduced-motion frame for seated pets', async () => {
    const harness = createHarness({ reducedMotion: true })
    harness.runtime.mount()
    harness.runtime.update(seatState({
      occupantsByDeskId: new Map([
        ['desk-1', { kind: 'self', name: '我', status: 'running', timerMode: 'focus', todayFocusSeconds: 0 }]
      ])
    }))
    await settleAssetLoad()
    renderNextFrame(harness, 480)

    const seatedPetDraw = vi.mocked(harness.context.drawImage).mock.calls.find((call) => call.length === 9)
    expect(seatedPetDraw?.[1]).toBe(0)
    harness.runtime.dispose()
  })

  it('draws a seated pet at the desk seat projection', async () => {
    const harness = createHarness()
    harness.runtime.mount()
    harness.runtime.update(seatState({
      occupantsByDeskId: new Map([
        ['desk-1', { kind: 'self', name: '我', status: 'running', timerMode: 'focus', todayFocusSeconds: 0 }]
      ])
    }))
    await settleAssetLoad()
    renderNextFrame(harness, 480)

    const seatedPetDraw = vi.mocked(harness.context.drawImage).mock.calls.find((call) => call.length === 9)
    expect(seatedPetDraw?.slice(5)).toEqual([112, 156, 96, 104])
    harness.runtime.dispose()
  })
})
