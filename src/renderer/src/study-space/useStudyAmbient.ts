import { useEffect } from 'react'

export function useStudyAmbient(enabled: boolean, volume: number): void {
  useEffect(() => {
    if (!enabled) return undefined
    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return undefined

    const context = new AudioContextCtor()
    const gain = context.createGain()
    gain.gain.value = Math.min(0.16, Math.max(0, volume) * 0.16)
    gain.connect(context.destination)

    const filter = context.createBiquadFilter()
    filter.connect(gain)
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * 2))
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < bufferSize; index += 1) {
      data[index] = (Math.random() * 2 - 1) * 0.32
    }

    filter.type = 'highpass'
    filter.frequency.value = 420

    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(filter)
    void context.resume().catch(() => undefined)
    source.start()

    return () => {
      source.stop()
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
      void context.close().catch(() => undefined)
    }
  }, [enabled, volume])
}
