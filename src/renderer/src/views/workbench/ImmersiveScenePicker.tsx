import { Trash2, Upload, X } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { customScenePreference } from './immersive-custom-media-store'
import { IMMERSIVE_BUILT_IN_SCENES } from './immersive-scene-catalog'
import {
  ImmersiveFocusTimerPickerPreview,
  type ImmersiveFocusTimerFaceModel
} from './ImmersiveFocusTimerScene'
import { ClockDisplay } from './immersive-clock-display'
import {
  IMMERSIVE_MEDIA_ACCEPT,
  type ImmersiveCustomMediaItem,
  type ImmersiveSceneId
} from './immersive-scene-types'

export type ImmersiveScenePickerProps = {
  clockTime: Date
  previousClockTime: Date | null
  immersiveScene: ImmersiveSceneId
  customImmersiveMediaList: readonly ImmersiveCustomMediaItem[]
  editingCustomSceneId: string | null
  customSceneNameDraft: string
  isSceneDropActive: boolean
  sceneFileInputRef: RefObject<HTMLInputElement | null>
  focusTimerFace: ImmersiveFocusTimerFaceModel
  onClose: () => void
  onSelectScene: (scene: ImmersiveSceneId) => void
  onApplyFiles: (files: File[]) => void
  setIsSceneDropActive: (active: boolean) => void
  setCustomSceneNameDraft: (value: string) => void
  setEditingCustomSceneId: (id: string | null) => void
  startCustomSceneNameEditing: (id: string) => void
  finishCustomSceneNameEditing: () => void
  removeCustomImmersiveMedia: (id: string) => void
}

export function ImmersiveScenePicker(props: ImmersiveScenePickerProps) {
  const {
    clockTime,
    previousClockTime,
    immersiveScene,
    customImmersiveMediaList,
    editingCustomSceneId,
    customSceneNameDraft,
    isSceneDropActive,
    sceneFileInputRef,
    focusTimerFace,
    onClose,
    onSelectScene,
    onApplyFiles,
    setIsSceneDropActive,
    setCustomSceneNameDraft,
    setEditingCustomSceneId,
    startCustomSceneNameEditing,
    finishCustomSceneNameEditing,
    removeCustomImmersiveMedia
  } = props

  return (
    <div
      className={`workbench-scene-picker-backdrop${isSceneDropActive ? ' is-drop-active' : ''}`}
      role="presentation"
      onMouseDown={() => onClose()}
      onDragEnter={(event) => {
        event.preventDefault()
        setIsSceneDropActive(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setIsSceneDropActive(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsSceneDropActive(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setIsSceneDropActive(false)
        const files = Array.from(event.dataTransfer.files ?? [])
        onApplyFiles(files)
      }}
    >
      <section
        className="workbench-scene-picker"
        role="dialog"
        aria-modal="true"
        aria-label="选择场景"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="workbench-scene-picker__header">
          <h2 className="workbench-scene-picker__title">选择场景</h2>
          <button
            type="button"
            className="workbench-scene-picker__close"
            onClick={() => onClose()}
            aria-label="关闭场景选择"
            title="关闭"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="workbench-scene-picker__grid">
          {IMMERSIVE_BUILT_IN_SCENES.map((scene) => {
            const isSelected = immersiveScene === scene.id
            let preview: ReactNode
            if (scene.kind === 'clock') {
              preview = (
                <div className="workbench-scene-picker__clock-preview workbench-clock" aria-hidden="true">
                  <ClockDisplay time={clockTime} previousTime={previousClockTime} />
                </div>
              )
            } else if (scene.kind === 'focus-timer') {
              preview = <ImmersiveFocusTimerPickerPreview face={focusTimerFace} />
            } else if (scene.kind === 'video' && scene.src) {
              preview = (
                <video
                  className="workbench-scene-picker__video-preview"
                  src={scene.src}
                  muted
                  loop
                  autoPlay
                  playsInline
                  preload="metadata"
                  aria-hidden="true"
                />
              )
            } else if (scene.kind === 'image' && scene.src) {
              preview = (
                <img
                  className="workbench-scene-picker__video-preview"
                  src={scene.src}
                  alt=""
                  aria-hidden="true"
                />
              )
            } else {
              preview = null
            }

            return (
              <button
                key={scene.id}
                type="button"
                className={`workbench-scene-picker__preset workbench-scene-picker__preset--${scene.id}${isSelected ? ' is-selected' : ''}`}
                onClick={() => onSelectScene(scene.id)}
                aria-label={scene.label}
                aria-pressed={isSelected}
              >
                {preview}
                <span className="workbench-scene-picker__preset-copy">
                  <strong>{scene.label}</strong>
                </span>
                {isSelected ? <span className="workbench-scene-picker__selected-mark">当前</span> : null}
              </button>
            )
          })}
          {customImmersiveMediaList.map((customMedia) => {
            const sceneId = customScenePreference(customMedia.id)
            const isSelected = immersiveScene === sceneId
            const isEditing = editingCustomSceneId === customMedia.id
            return (
              <div
                key={customMedia.id}
                className={`workbench-scene-picker__preset workbench-scene-picker__preset--custom${isSelected ? ' is-selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelectScene(sceneId)}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  startCustomSceneNameEditing(customMedia.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectScene(sceneId)
                  }
                }}
                aria-label={customMedia.name || '自定义场景'}
                aria-pressed={isSelected}
              >
                {customMedia.kind === 'image' ? (
                  <img
                    className="workbench-scene-picker__video-preview"
                    src={customMedia.url}
                    alt=""
                    aria-hidden="true"
                  />
                ) : (
                  <video
                    className="workbench-scene-picker__video-preview"
                    src={customMedia.url}
                    muted
                    loop
                    autoPlay
                    playsInline
                    preload="metadata"
                    aria-hidden="true"
                  />
                )}
                <span className="workbench-scene-picker__preset-copy">
                  {isEditing ? (
                    <input
                      className="workbench-scene-picker__name-input"
                      value={customSceneNameDraft}
                      onChange={(event) => setCustomSceneNameDraft(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onBlur={finishCustomSceneNameEditing}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          finishCustomSceneNameEditing()
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setEditingCustomSceneId(null)
                        }
                      }}
                      aria-label="编辑自定义场景名称"
                      autoFocus
                    />
                  ) : (
                    <strong>{customMedia.name || '自定义场景'}</strong>
                  )}
                </span>
                <button
                  type="button"
                  className="workbench-scene-picker__delete"
                  onClick={(event) => {
                    event.stopPropagation()
                    removeCustomImmersiveMedia(customMedia.id)
                  }}
                  aria-label={`删除自定义场景 ${customMedia.name || ''}`.trim()}
                  title="删除自定义场景"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
                {isSelected ? <span className="workbench-scene-picker__selected-mark">当前</span> : null}
              </div>
            )
          })}
        </div>
        <div
          className={`workbench-scene-picker__upload${isSceneDropActive ? ' is-drop-active' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => sceneFileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              sceneFileInputRef.current?.click()
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setIsSceneDropActive(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setIsSceneDropActive(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setIsSceneDropActive(false)
            const files = Array.from(event.dataTransfer.files ?? [])
            onApplyFiles(files)
          }}
        >
          <input
            ref={sceneFileInputRef}
            type="file"
            className="workbench-scene-picker__file-input"
            accept={IMMERSIVE_MEDIA_ACCEPT}
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              onApplyFiles(files)
              event.target.value = ''
            }}
          />
          <Upload size={22} aria-hidden="true" />
          <strong>添加视频或图片</strong>
          <span>点击选择，或拖放到此处</span>
          <button
            type="button"
            className="workbench-scene-picker__upload-btn"
            onClick={(event) => {
              event.stopPropagation()
              sceneFileInputRef.current?.click()
            }}
          >
            选择文件
          </button>
        </div>
      </section>
    </div>
  )
}
