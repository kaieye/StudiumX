import { useEffect, useRef } from 'react'
import { AmbientPlayback } from './ambient-playback'

export function useStudyAmbient(enabled: boolean, volume: number): void {
  const playbackRef = useRef<AmbientPlayback | null>(null)

  useEffect(() => {
    const playback = new AmbientPlayback()
    playbackRef.current = playback

    return () => {
      playback.dispose()
      if (playbackRef.current === playback) playbackRef.current = null
    }
  }, [])

  useEffect(() => {
    playbackRef.current?.reconcile({ enabled, volume })
  }, [enabled, volume])
}
