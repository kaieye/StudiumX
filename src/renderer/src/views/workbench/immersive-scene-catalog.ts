import cloudGlowScene from '../../assets/images/workbench/scenes/cloud-glow.png'
import summerLakesideScene from '../../assets/images/workbench/scenes/summer-lakeside.png'
import girlVideo from '../../assets/videos/workbench/girl.mp4'
import type { BuiltInImmersiveSceneId } from './immersive-custom-media-store'

export type ImmersiveBuiltInSceneKind = 'clock' | 'focus-timer' | 'video' | 'image'

export type ImmersiveBuiltInSceneDef = {
  id: BuiltInImmersiveSceneId
  label: string
  kind: ImmersiveBuiltInSceneKind
  /** Media URL for video/image presets; omitted for clock and focus-timer. */
  src?: string
}

/** Built-in immersive scene registry (order = picker grid order). */
export const IMMERSIVE_BUILT_IN_SCENES: readonly ImmersiveBuiltInSceneDef[] = [
  { id: 'clock', label: '翻页时钟', kind: 'clock' },
  { id: 'focus-timer', label: '专注计时', kind: 'focus-timer' },
  { id: 'girl', label: '室内自习', kind: 'video', src: girlVideo },
  { id: 'cloud-glow', label: '云蒸霞光', kind: 'image', src: cloudGlowScene },
  { id: 'summer-lakeside', label: '夏日湖畔', kind: 'image', src: summerLakesideScene }
] as const

const byId = new Map<BuiltInImmersiveSceneId, ImmersiveBuiltInSceneDef>(
  IMMERSIVE_BUILT_IN_SCENES.map((scene) => [scene.id, scene])
)

export function getBuiltInImmersiveScene(
  id: BuiltInImmersiveSceneId
): ImmersiveBuiltInSceneDef | undefined {
  return byId.get(id)
}
