import { afterEach, describe, expect, it, vi } from 'vitest'
import { AmbientPlayback } from '@renderer/study-space/ambient-playback'

type MockAudioGraph = {
  gain: GainNode
  filter: BiquadFilterNode
  buffer: AudioBuffer
  source: AudioBufferSourceNode
  resume: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  createBufferSource: ReturnType<typeof vi.fn>
}

type MockAudioContextConstructor = new () => AudioContext

const originalAudioContext = Object.getOwnPropertyDescriptor(window, 'AudioContext')
const originalWebkitAudioContext = Object.getOwnPropertyDescriptor(window, 'webkitAudioContext')

function restoreWindowProperty(name: 'AudioContext' | 'webkitAudioContext', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor)
  } else {
    Reflect.deleteProperty(window, name)
  }
}

function installAudioConstructors({
  standard,
  legacy
}: {
  standard?: MockAudioContextConstructor
  legacy?: MockAudioContextConstructor
}): void {
  Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value: standard })
  Object.defineProperty(window, 'webkitAudioContext', { configurable: true, writable: true, value: legacy })
}

function createAudioContextConstructor({ resume = vi.fn(() => Promise.resolve()) }: {
  resume?: ReturnType<typeof vi.fn>
} = {}): { Constructor: MockAudioContextConstructor; graphs: MockAudioGraph[] } {
  const graphs: MockAudioGraph[] = []

  class MockAudioContext {
    readonly sampleRate = 4
    readonly destination = {} as AudioDestinationNode
    readonly gain = {
      gain: { value: -1 },
      connect: vi.fn(),
      disconnect: vi.fn()
    } as unknown as GainNode
    readonly filter = {
      type: 'lowpass',
      frequency: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn()
    } as unknown as BiquadFilterNode
    readonly buffer = {
      getChannelData: vi.fn(() => new Float32Array(this.sampleRate * 2))
    } as unknown as AudioBuffer
    readonly source = {
      buffer: null,
      loop: false,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn()
    } as unknown as AudioBufferSourceNode
    readonly close = vi.fn(() => Promise.resolve())
    readonly createBufferSource = vi.fn(() => this.source)

    constructor() {
      graphs.push({
        gain: this.gain,
        filter: this.filter,
        buffer: this.buffer,
        source: this.source,
        resume,
        close: this.close,
        createBufferSource: this.createBufferSource
      })
    }

    createGain(): GainNode {
      return this.gain
    }

    createBiquadFilter(): BiquadFilterNode {
      return this.filter
    }

    createBuffer(): AudioBuffer {
      return this.buffer
    }

    resume(): Promise<void> {
      return resume() as Promise<void>
    }
  }

  return { Constructor: MockAudioContext as unknown as MockAudioContextConstructor, graphs }
}

afterEach(() => {
  restoreWindowProperty('AudioContext', originalAudioContext)
  restoreWindowProperty('webkitAudioContext', originalWebkitAudioContext)
  vi.restoreAllMocks()
})

describe('AmbientPlayback', () => {
  it('does not construct browser audio while disabled', () => {
    const standard = createAudioContextConstructor()
    installAudioConstructors({ standard: standard.Constructor })

    new AmbientPlayback().reconcile({ enabled: false, volume: 0.45 })

    expect(standard.graphs).toHaveLength(0)
  })

  it('uses webkitAudioContext when the standard constructor is unavailable', () => {
    const legacy = createAudioContextConstructor()
    installAudioConstructors({ legacy: legacy.Constructor })

    const playback = new AmbientPlayback()
    playback.reconcile({ enabled: true, volume: 0.45 })

    expect(legacy.graphs).toHaveLength(1)
    expect(legacy.graphs[0].source.start).toHaveBeenCalledTimes(1)
    playback.dispose()
  })

  it('clamps volume to the supported gain range', () => {
    const standard = createAudioContextConstructor()
    installAudioConstructors({ standard: standard.Constructor })
    const playback = new AmbientPlayback()

    playback.reconcile({ enabled: true, volume: -0.5 })
    expect(standard.graphs[0].gain.gain.value).toBe(0)

    playback.reconcile({ enabled: true, volume: 2 })
    expect(standard.graphs[0].gain.gain.value).toBe(0.16)

    playback.reconcile({ enabled: true, volume: Number.NaN })
    expect(standard.graphs[0].gain.gain.value).toBe(0)
    playback.dispose()
  })

  it('reuses one source while enabled across repeated reconciliations', () => {
    const standard = createAudioContextConstructor()
    installAudioConstructors({ standard: standard.Constructor })
    const playback = new AmbientPlayback()

    playback.reconcile({ enabled: true, volume: 0.25 })
    playback.reconcile({ enabled: true, volume: 0.75 })
    playback.reconcile({ enabled: true, volume: 0.5 })

    expect(standard.graphs).toHaveLength(1)
    expect(standard.graphs[0].createBufferSource).toHaveBeenCalledTimes(1)
    expect(standard.graphs[0].source.start).toHaveBeenCalledTimes(1)
    expect(standard.graphs[0].gain.gain.value).toBe(0.08)
    playback.dispose()
  })

  it('keeps playback alive when context resume rejects', async () => {
    const resume = vi.fn(() => Promise.reject(new Error('gesture required')))
    const standard = createAudioContextConstructor({ resume })
    installAudioConstructors({ standard: standard.Constructor })
    const playback = new AmbientPlayback()

    expect(() => playback.reconcile({ enabled: true, volume: 0.5 })).not.toThrow()
    await Promise.resolve()

    expect(resume).toHaveBeenCalledTimes(1)
    expect(standard.graphs[0].source.start).toHaveBeenCalledTimes(1)
    playback.dispose()
  })

  it('stops, disconnects, and closes exactly once across disabled reconciliation and disposal', () => {
    const standard = createAudioContextConstructor()
    installAudioConstructors({ standard: standard.Constructor })
    const playback = new AmbientPlayback()

    playback.reconcile({ enabled: true, volume: 0.5 })
    playback.reconcile({ enabled: false, volume: 0.5 })
    playback.dispose()

    const graph = standard.graphs[0]
    expect(graph.source.stop).toHaveBeenCalledTimes(1)
    expect(graph.source.disconnect).toHaveBeenCalledTimes(1)
    expect(graph.filter.disconnect).toHaveBeenCalledTimes(1)
    expect(graph.gain.disconnect).toHaveBeenCalledTimes(1)
    expect(graph.close).toHaveBeenCalledTimes(1)
  })

  it('makes disposal idempotent', () => {
    const standard = createAudioContextConstructor()
    installAudioConstructors({ standard: standard.Constructor })
    const playback = new AmbientPlayback()

    playback.reconcile({ enabled: true, volume: 0.5 })
    playback.dispose()
    playback.dispose()

    const graph = standard.graphs[0]
    expect(graph.source.stop).toHaveBeenCalledTimes(1)
    expect(graph.close).toHaveBeenCalledTimes(1)
  })
})
