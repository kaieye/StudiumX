import assert from 'node:assert/strict'

import {
  DEFAULT_LESSON_STYLE_ID,
  LESSON_STYLE_IDS,
  LESSON_STYLES,
  isLessonStyleId,
  lessonStyleCss,
  normalizeLessonStyleId
} from '../../src/shared/lesson-styles'
import { LessonStyleRegistry, lessonStyleRegistry } from '../../src/shared/lesson-style-registry'

// Ordered definitions remain the source of the public style IDs and gallery list.
assert.deepEqual(
  LESSON_STYLES.map((style) => style.id),
  LESSON_STYLE_IDS
)
assert.equal(LESSON_STYLES, lessonStyleRegistry.styles)
assert.equal(lessonStyleRegistry.defaultId, DEFAULT_LESSON_STYLE_ID)

// ID recognition and fallback preserve the public normalization contract.
assert.equal(isLessonStyleId('classic'), true)
assert.equal(isLessonStyleId('unknown'), false)
assert.equal(lessonStyleRegistry.isStyleId('classic'), true)
assert.equal(lessonStyleRegistry.isStyleId('unknown'), false)
assert.equal(normalizeLessonStyleId('nightfall'), 'nightfall')
assert.equal(lessonStyleRegistry.normalize('nightfall'), 'nightfall')
assert.equal(normalizeLessonStyleId(' NIGHTFALL '), DEFAULT_LESSON_STYLE_ID)
assert.equal(lessonStyleRegistry.normalize(' NIGHTFALL '), DEFAULT_LESSON_STYLE_ID)

// CSS lookup uses the definition associated with the normalized ID.
for (const style of LESSON_STYLES) {
  assert.equal(lessonStyleRegistry.css(style.id), style.css)
  assert.equal(lessonStyleCss(style.id), style.css)
}
assert.equal(lessonStyleRegistry.css('unknown'), lessonStyleRegistry.css(DEFAULT_LESSON_STYLE_ID))
assert.equal(lessonStyleCss('unknown'), lessonStyleCss(DEFAULT_LESSON_STYLE_ID))

// Registry construction rejects invalid catalogs before any lookup can occur.
assert.throws(
  () => new LessonStyleRegistry([LESSON_STYLES[0], LESSON_STYLES[0]], LESSON_STYLES[0].id),
  /duplicate id/
)
assert.throws(
  () => new LessonStyleRegistry([LESSON_STYLES[0]], DEFAULT_LESSON_STYLE_ID),
  /default id .* is not registered/
)

console.log('lesson style registry ok')
