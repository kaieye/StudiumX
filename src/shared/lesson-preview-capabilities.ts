export type LessonPreviewCapabilities = {
  math: boolean
  mermaid: boolean
}

export const DEFAULT_LESSON_PREVIEW_CAPABILITIES: LessonPreviewCapabilities = {
  math: false,
  mermaid: false
}

export const RICH_LESSON_PREVIEW_CAPABILITIES: LessonPreviewCapabilities = {
  math: true,
  mermaid: true
}

export const STATIC_LESSON_RENDERER_CAPABILITIES: LessonPreviewCapabilities = {
  math: true,
  mermaid: false
}
