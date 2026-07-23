import type { ReactElement, ReactNode } from 'react'
import { parseCustomSceneId } from './immersive-custom-media-store'
import { getBuiltInImmersiveScene } from './immersive-scene-catalog'
import {
  ImmersiveFocusTimerScene,
  type ImmersiveFocusTimerFaceModel
} from './ImmersiveFocusTimerScene'
import type { ImmersiveCustomMediaItem, ImmersivePhase, ImmersiveSceneId } from './immersive-scene-types'

export function ImmersiveSceneLayer(props: {
  immersivePhase: ImmersivePhase
  onCloseAnimationEnd: () => void
  children: ReactNode
}): ReactElement {
  const { immersivePhase, onCloseAnimationEnd, children } = props
  return (
    <div
      id="workbench-immersive-layer"
      className={`workbench-immersive-layer${
        immersivePhase === 'open' ? ' is-open' : immersivePhase === 'closing' ? ' is-closing' : ''
      }`}
      aria-hidden={immersivePhase === 'closed'}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && immersivePhase === 'closing') {
          onCloseAnimationEnd()
        }
      }}
    >
      {children}
    </div>
  )
}

export function ImmersiveScenePlane(props: {
  immersiveScene: ImmersiveSceneId
  customImmersiveMediaList: ImmersiveCustomMediaItem[]
  clockTime: Date
  previousClockTime: Date | null
  focusTimerFace: ImmersiveFocusTimerFaceModel
  timerMode: string | null | undefined
  renderClock: (time: Date, previousTime: Date | null) => ReactNode
}): ReactElement {
  const {
    immersiveScene,
    customImmersiveMediaList,
    clockTime,
    previousClockTime,
    focusTimerFace,
    timerMode,
    renderClock
  } = props

  let content: ReactNode
  const builtIn = !immersiveScene.startsWith('custom:')
    ? getBuiltInImmersiveScene(immersiveScene as Parameters<typeof getBuiltInImmersiveScene>[0])
    : undefined

  if (builtIn?.kind === 'clock') {
    content = (
      <div className="workbench-immersive-clock-scene workbench-clock" aria-hidden="true">
        {renderClock(clockTime, previousClockTime)}
      </div>
    )
  } else if (builtIn?.kind === 'focus-timer') {
    content = <ImmersiveFocusTimerScene face={focusTimerFace} timerMode={timerMode} />
  } else if (builtIn?.kind === 'video' && builtIn.src) {
    content = (
      <video
        className="workbench-immersive-video"
        src={builtIn.src}
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      />
    )
  } else if (builtIn?.kind === 'image' && builtIn.src) {
    content = (
      <img className="workbench-immersive-video" src={builtIn.src} alt="" aria-hidden="true" />
    )
  } else {
    const activeCustom = immersiveScene.startsWith('custom:')
      ? customImmersiveMediaList.find((item) => item.id === parseCustomSceneId(immersiveScene)) ??
        null
      : null
    if (activeCustom?.kind === 'image') {
      content = (
        <img
          className="workbench-immersive-video"
          src={activeCustom.url}
          alt=""
          aria-hidden="true"
        />
      )
    } else if (activeCustom?.kind === 'video') {
      content = (
        <video
          className="workbench-immersive-video"
          src={activeCustom.url}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
        />
      )
    } else {
      content = (
        <div className="workbench-immersive-clock-scene workbench-clock" aria-hidden="true">
          {renderClock(clockTime, previousClockTime)}
        </div>
      )
    }
  }

  return (
    <div className="workbench-immersive-plane">
      {content}
      <div className="workbench-immersive-vignette" aria-hidden="true" />
    </div>
  )
}
