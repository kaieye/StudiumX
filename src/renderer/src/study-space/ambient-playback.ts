const AMBIENT_GAIN_MAX = 0.16
const NOISE_DURATION_SECONDS = 2
const NOISE_AMPLITUDE = 0.32

type AmbientAudioContext = {
  readonly sampleRate: number
  readonly destination: AudioNode
  createGain(): GainNode
  createBiquadFilter(): BiquadFilterNode
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer
  createBufferSource(): AudioBufferSourceNode
  resume(): Promise<void>
  close(): Promise<void>
}

type AmbientAudioContextConstructor = new () => AmbientAudioContext

type AmbientWindow = Window & typeof globalThis & {
  webkitAudioContext?: AmbientAudioContextConstructor
}

export type AmbientPlaybackOptions = {
  enabled: boolean
  volume: number
}

function createAudioContext(): AmbientAudioContext | null {
  if (typeof window === 'undefined') return null

  const browserWindow = window as AmbientWindow
  const AudioContextCtor = browserWindow.AudioContext as AmbientAudioContextConstructor | undefined
    ?? browserWindow.webkitAudioContext

  return AudioContextCtor ? new AudioContextCtor() : null
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0
  return Math.min(1, Math.max(0, volume))
}

function ignoreFailure(operation: () => void): void {
  try {
    operation()
  } catch {
    // Browser audio nodes can already be stopped or disconnected during teardown.
  }
}

/**
 * Owns the lifetime of the browser graph used for Study Space's looping white noise.
 * Reconcile it whenever settings change, then dispose it when the owning session unmounts.
 */
export class AmbientPlayback {
  private context: AmbientAudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private filter: BiquadFilterNode | null = null
  private gain: GainNode | null = null

  reconcile({ enabled, volume }: AmbientPlaybackOptions): void {
    if (!enabled) {
      this.teardown()
      return
    }

    if (!this.context) this.start()
    if (this.gain) this.gain.gain.value = clampVolume(volume) * AMBIENT_GAIN_MAX
  }

  dispose(): void {
    this.teardown()
  }

  private start(): void {
    const context = createAudioContext()
    if (!context) return

    const gain = context.createGain()
    const filter = context.createBiquadFilter()
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * NOISE_DURATION_SECONDS))
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate)
    const data = buffer.getChannelData(0)

    for (let index = 0; index < bufferSize; index += 1) {
      data[index] = (Math.random() * 2 - 1) * NOISE_AMPLITUDE
    }

    filter.type = 'highpass'
    filter.frequency.value = 420
    filter.connect(gain)
    gain.connect(context.destination)

    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(filter)

    this.context = context
    this.source = source
    this.filter = filter
    this.gain = gain

    try {
      void context.resume().catch(() => undefined)
    } catch {
      // Resume can fail before a user gesture; the graph remains ready for a later retry.
    }

    try {
      source.start()
    } catch {
      this.teardown()
    }
  }

  private teardown(): void {
    const source = this.source
    const filter = this.filter
    const gain = this.gain
    const context = this.context

    this.source = null
    this.filter = null
    this.gain = null
    this.context = null

    if (source) {
      ignoreFailure(() => source.stop())
      ignoreFailure(() => source.disconnect())
    }
    if (filter) ignoreFailure(() => filter.disconnect())
    if (gain) ignoreFailure(() => gain.disconnect())
    if (context) {
      try {
        void context.close().catch(() => undefined)
      } catch {
        // A partially initialized browser context should not break React cleanup.
      }
    }
  }
}
