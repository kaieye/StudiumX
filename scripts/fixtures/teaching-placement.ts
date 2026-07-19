import assert from 'node:assert/strict'

import {
  buildLessonArtifactPlacement,
  courseRelativePathFromCourseName,
  courseRelativePathFromWorkspacePath,
  deriveLessonPlacementFromRelativePath,
  describeCoursePlacement,
  isCourseRelativePath,
  isDefaultCourseRelativePath,
  lessonFolderNameForCourse,
  lessonFolderRelativePathForCourse,
  normalizeTeachingRelativePath
} from '../../src/shared/teaching-placement'

assert.equal(normalizeTeachingRelativePath('./courses/rag/'), 'courses/rag')
assert.equal(courseRelativePathFromCourseName('Teach RAG', undefined), 'lessons')
assert.equal(courseRelativePathFromCourseName('Teach RAG', 'Teach RAG'), 'lessons')
assert.equal(courseRelativePathFromCourseName('Teach RAG', 'RAG Project'), 'courses/rag-project')

assert.deepEqual(describeCoursePlacement({ workspaceName: 'Teach RAG', courseRelativePath: 'lessons' }), {
  courseId: 'teach-rag',
  courseName: 'Teach RAG',
  courseRelativePath: 'lessons'
})
assert.deepEqual(describeCoursePlacement({ workspaceName: 'Teach RAG', courseRelativePath: 'courses/rag-project' }), {
  courseId: 'rag-project',
  courseName: 'Rag Project',
  courseRelativePath: 'courses/rag-project'
})

assert.equal(isDefaultCourseRelativePath('lessons'), true)
assert.equal(isCourseRelativePath('courses/rag-project'), true)
assert.equal(isCourseRelativePath('courses/rag-project/lesson'), false)
assert.equal(courseRelativePathFromWorkspacePath('lessons/0001-intro.html'), 'lessons')
assert.equal(courseRelativePathFromWorkspacePath('courses/rag-project/lesson/0001-intro.html'), 'courses/rag-project')
assert.equal(courseRelativePathFromWorkspacePath('learning-records/0001-intro.md'), null)

assert.equal(lessonFolderNameForCourse('lessons'), 'lessons')
assert.equal(lessonFolderNameForCourse('courses/rag-project'), 'lesson')
assert.equal(lessonFolderRelativePathForCourse('lessons'), 'lessons')
assert.equal(lessonFolderRelativePathForCourse('courses/rag-project'), 'courses/rag-project/lesson')

assert.deepEqual(
  buildLessonArtifactPlacement({
    workspaceName: 'Teach RAG',
    sequence: 3,
    title: 'Retriever Tuning',
    requestedCourseName: 'RAG Project',
    includeReference: true,
    includeReviews: true
  }),
  {
    courseId: 'rag-project',
    courseName: 'Rag Project',
    courseRelativePath: 'courses/rag-project',
    sessionId: 'lesson-0003',
    sessionName: '0003 Retriever Tuning',
    sessionRelativePath: 'courses/rag-project/lesson',
    lessonRelativePath: 'courses/rag-project/lesson/0003-retriever-tuning.html',
    assessmentRelativePath: 'courses/rag-project/lesson/0003-retriever-tuning-assessment.json',
    referenceRelativePath: 'courses/rag-project/lesson/0003-retriever-tuning-reference.html',
    reviewsRelativePath: 'courses/rag-project/lesson/0003-retriever-tuning-flashcards.json'
  }
)

assert.deepEqual(
  deriveLessonPlacementFromRelativePath({
    workspaceName: 'Teach RAG',
    relativePath: 'courses/rag-project/lesson/0003-retriever-tuning.html'
  }),
  {
    courseId: 'rag-project',
    courseName: 'Rag Project',
    courseRelativePath: 'courses/rag-project',
    sessionId: 'lesson-0003',
    sessionName: 'Retriever Tuning',
    sessionRelativePath: 'courses/rag-project/lesson'
  }
)

console.log('teaching placement rules ok')
