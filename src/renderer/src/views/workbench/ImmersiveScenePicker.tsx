import { Trash2, Upload, X } from 'lucide-react'
import type { RefObject } from 'react'
import cloudGlowScene from '../../assets/images/workbench/scenes/cloud-glow.png'
import summerLakesideScene from '../../assets/images/workbench/scenes/summer-lakeside.png'
import girlVideo from '../../assets/videos/workbench/girl.mp4'
import { customScenePreference } from './immersive-custom-media-store'
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
                <button
                  type="button"
                  className={`workbench-scene-picker__preset workbench-scene-picker__preset--clock${immersiveScene === 'clock' ? ' is-selected' : ''}`}
                  onClick={() => onSelectScene('clock')}
                  aria-label="翻页时钟"
                  aria-pressed={immersiveScene === 'clock'}
                >
                  <div className="workbench-scene-picker__clock-preview workbench-clock" aria-hidden="true">
                    <ClockDisplay time={clockTime} previousTime={previousClockTime} />
                  </div>
                  <span className="workbench-scene-picker__preset-copy">
                    <strong>翻页时钟</strong>
                  </span>
                  {immersiveScene === 'clock' ? <span className="workbench-scene-picker__selected-mark">当前</span> : null}
                </button>
                                <button
                  type="button"
                  className={`workbench-scene-picker__preset workbench-scene-picker__preset--focus-timer${immersiveScene === 'focus-timer' ? ' is-selected' : ''}`}
                  onClick={() => onSelectScene('focus-timer')}
                  aria-label="专注计时"
                  aria-pressed={immersiveScene === 'focus-timer'}
                >
                  <ImmersiveFocusTimerPickerPreview face={focusTimerFace} />
                  <span className="workbench-scene-picker__preset-copy">
                    <strong>专注计时</strong>
                  </span>
                  {immersiveScene === 'focus-timer' ? (
                    <span className="workbench-scene-picker__selected-mark">当前</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className={`workbench-scene-picker__preset workbench-scene-picker__preset--girl${immersiveScene === 'girl' ? ' is-selected' : ''}`}
                  onClick={() => onSelectScene('girl')}
                  aria-label="室内自习"
                  aria-pressed={immersiveScene === 'girl'}
                >
                  <video
                    className="workbench-scene-picker__video-preview"
                    src={girlVideo}
                    muted
                    loop
                    autoPlay
                    playsInline
                    preload="metadata"
                    aria-hidden="true"
                  />
                  <span className="workbench-scene-picker__preset-copy">
                    <strong>室内自习</strong>
                  </span>
                  {immersiveScene === 'girl' ? <span className="workbench-scene-picker__selected-mark">当前</span> : null}
                </button>
                <button
                  type="button"
                  className={`workbench-scene-picker__preset workbench-scene-picker__preset--cloud-glow${immersiveScene === 'cloud-glow' ? ' is-selected' : ''}`}
                  onClick={() => onSelectScene('cloud-glow')}
                  aria-label="云蒸霞光"
                  aria-pressed={immersiveScene === 'cloud-glow'}
                >
                  <img
                    className="workbench-scene-picker__video-preview"
                    src={cloudGlowScene}
                    alt=""
                    aria-hidden="true"
                  />
                  <span className="workbench-scene-picker__preset-copy">
                    <strong>云蒸霞光</strong>
                  </span>
                  {immersiveScene === 'cloud-glow' ? <span className="workbench-scene-picker__selected-mark">当前</span> : null}
                </button>
                <button
                  type="button"
                  className={`workbench-scene-picker__preset workbench-scene-picker__preset--summer-lakeside${immersiveScene === 'summer-lakeside' ? ' is-selected' : ''}`}
                  onClick={() => onSelectScene('summer-lakeside')}
                  aria-label="夏日湖畔"
                  aria-pressed={immersiveScene === 'summer-lakeside'}
                >
                  <img
                    className="workbench-scene-picker__video-preview"
                    src={summerLakesideScene}
                    alt=""
                    aria-hidden="true"
                  />
                  <span className="workbench-scene-picker__preset-copy">
                    <strong>夏日湖畔</strong>
                  </span>
                  {immersiveScene === 'summer-lakeside' ? <span className="workbench-scene-picker__selected-mark">当前</span> : null}
                </button>
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
