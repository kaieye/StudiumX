import assert from 'node:assert/strict'

import {
  appendStreamingPreview,
  beginLessonGeneration,
  directLessonDonePatch,
  effectsForAgentGeneratedLessons,
  effectsForGeneratedLesson,
  failLessonGeneration,
  failStreamingLessonGeneration,
  lessonGenerationDefaultRuntime,
  streamedLessonDonePatch,
  suggestedCourseName,
  updateStreamingStatus
} from '../../src/renderer/src/app-shell/lessonGenerationFlow'
import type {
  GenerateLessonResult,
  LessonStreamDone,
  LessonSummary,
  TeachingAppState,
  TeachingWorkspaceSummary
} from '../../src/shared/teaching-types'

const lesson: LessonSummary = {
  id: '0001',
  title: 'RAG Basics',
  objective: 'Understand RAG',
  prompt: 'Learn RAG',
  createdAt: '2026-01-01T00:00:00.000Z',
  durationMinutes: 15,
  courseId: 'course-rag',
  courseName: 'RAG',
  courseRelativePath: 'courses/rag',
  courseAbsolutePath: '/workspace/courses/rag',
  sessionId: 'session-1',
  sessionName: 'Retrieval Flow',
  sessionRelativePath: 'courses/rag/0001-retrieval-flow',
  sessionAbsolutePath: '/workspace/courses/rag/0001-retrieval-flow',
  relativePath: 'courses/rag/0001-retrieval-flow/index.html',
  absolutePath: '/workspace/courses/rag/0001-retrieval-flow/index.html'
}

const workspace: TeachingWorkspaceSummary = {
  id: 'workspace-1',
  name: 'Workspace',
  rootPath: '/workspace',
  missionPath: '/workspace/MISSION.md',
  resourcesPath: '/workspace/resources',
  lessonsDir: '/workspace/courses',
  recordsDir: '/workspace/records',
  referenceDir: '/workspace/references',
  reviewsDir: '/workspace/reviews',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  missionTitle: 'Learn retrieval',
  missionExcerpt: '',
  courses: [
    {
      id: 'course-rag',
      name: 'RAG',
      relativePath: 'courses/rag',
      absolutePath: '/workspace/courses/rag',
      lessonCount: 1,
      sessionCount: 1,
      sessions: [],
      conversations: []
    }
  ],
  fileTree: [],
  conversations: [],
  resources: [],
  records: [],
  lessons: [lesson],
  referenceCount: 0,
  assetsReady: true,
  git: null
}

const appState: TeachingAppState = {
  workspaces: [workspace],
  activeWorkspace: workspace,
  temporaryConversations: [],
  previewHtml: '',
  previewUrl: '',
  selectedLessonPath: null,
  runtime: lessonGenerationDefaultRuntime
}

const started = beginLessonGeneration({ appState, providerLabel: 'OpenAI gpt-test' })
assert.equal(started.generating, true)
assert.equal(started.error, null)
assert.equal(started.appState?.runtime.status, 'working')
assert.equal(started.appState?.runtime.providerLabel, 'OpenAI gpt-test')
assert.equal(appState.runtime.status, 'idle', 'begin patch must not mutate source app state')

assert.equal(suggestedCourseName(workspace, '学习 RAG 的检索链路。再做练习'), 'RAG 的检索链路')
assert.equal(suggestedCourseName({ ...workspace, courses: [] }, '   '), 'Workspace')

const preview = appendStreamingPreview({
  appState,
  liveText: '<section>first chunk</section>',
  workspace,
  labels: { language: 'en', hint: 'Streaming now', placeholder: 'Waiting' }
})
assert.equal(preview.appState?.previewUrl, '')
assert.match(preview.appState?.previewHtml ?? '', /Streaming now/)
assert.match(preview.appState?.previewHtml ?? '', /&lt;section&gt;first chunk&lt;\/section&gt;/)

const statusPatch = updateStreamingStatus({
  appState,
  status: { streamId: 'stream-1', step: 'validating' }
})
assert.equal(statusPatch.appState?.runtime.currentStep, 'validating JSON')

const result: GenerateLessonResult = {
  kind: 'lesson',
  state: { ...appState, selectedLessonPath: lesson.absolutePath },
  lesson,
  source: 'fallback',
  reason: 'model returned invalid JSON'
}
const directDone = directLessonDonePatch({ result, workspaceId: workspace.id, nextPrompt: 'next lesson' })
assert.equal(directDone.view, 'lessons')
assert.equal(directDone.lessonReaderOpen, true)
assert.equal(directDone.selectedCourseRelativePath, 'courses/rag')
assert.equal(directDone.selectedCourseWorkspaceId, workspace.id)
assert.equal(directDone.selectedCoursePreviewFile?.title, 'Retrieval Flow')
assert.equal(directDone.taskPrompt, 'next lesson')
assert.equal(directDone.generating, false)

const streamDone: LessonStreamDone = {
  streamId: 'stream-1',
  kind: 'lesson',
  state: appState,
  lesson,
  source: 'ai'
}
assert.equal(streamedLessonDonePatch({ done: streamDone, workspaceId: workspace.id, nextPrompt: 'next' })?.view, 'lessons')
assert.equal(
  streamedLessonDonePatch({ done: { streamId: 'stream-1', error: true, message: 'bad' }, workspaceId: workspace.id, nextPrompt: 'next' }),
  null
)

const failure = failLessonGeneration({ appState, error: { message: 'bad' } })
assert.equal(failure.generating, false)
assert.equal(failure.appState?.runtime.status, 'error')
assert.equal(failStreamingLessonGeneration({ message: 'bad' }).generating, false)

const effects = effectsForGeneratedLesson({
  lesson,
  source: 'fallback',
  reason: 'repair failed',
  settings: { autoOpenGeneratedLesson: true, notificationsEnabled: true, lessonGeneratedNotifications: true }
})
assert.equal(effects.openPath, lesson.absolutePath)
assert.deepEqual(effects.lessonGeneratedNotification, {
  title: lesson.title,
  path: lesson.relativePath,
  source: 'fallback',
  reason: 'repair failed'
})
assert.deepEqual(
  effectsForAgentGeneratedLessons({
    lessons: [lesson, { ...lesson, title: 'Second', absolutePath: '/workspace/second.html', relativePath: 'second.html' }],
    settings: { autoOpenGeneratedLesson: false, notificationsEnabled: true, lessonGeneratedNotifications: true }
  }),
  {
    lessonGeneratedNotification: {
      title: 'Second',
      path: 'second.html',
      source: 'ai',
      reason: undefined
    }
  }
)

console.log('lesson generation flow ok')
