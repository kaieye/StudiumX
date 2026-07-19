import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TeachingWorkspaceReviewDeck } from '../../src/main/teaching-workspace/review'

let rootPath = ''
try {
  rootPath = await mkdtemp(join(tmpdir(), 'teaching-workspace-review-deck-'))
  const workspace = { id: 'review-workspace', rootPath }
  const alphaArtifact = join(rootPath, 'courses', 'demo', 'lesson', '0001-alpha-flashcards.json')

  await mkdir(join(rootPath, 'courses', 'demo', 'lesson'), { recursive: true })
  await mkdir(join(rootPath, 'lessons'), { recursive: true })
  await mkdir(join(rootPath, 'reviews', 'nested'), { recursive: true })
  await mkdir(join(rootPath, '.studiumx'), { recursive: true })
  await writeFile(alphaArtifact, JSON.stringify({
    lessonId: ' lesson-alpha ',
    lessonTitle: ' Alpha lesson ',
    cards: [
      { front: 'Term A', back: 'Definition A' },
      { front: 'Term B', back: 'Definition B' },
      { front: 'Twin', back: 'Same answer' },
      { front: 'Twin', back: 'Same answer' }
    ]
  }), 'utf8')
  await writeFile(join(rootPath, 'reviews', 'nested', '0002-beta-flashcards.json'), JSON.stringify({
    lessonId: 'lesson-beta',
    cards: [{ id: 'beta-card', front: 'Beta term', back: 'Beta definition' }]
  }), 'utf8')
  await writeFile(join(rootPath, 'lessons', 'broken-flashcards.json'), '{ invalid json', 'utf8')
  await writeFile(join(rootPath, 'lessons', 'invalid-flashcards.json'), JSON.stringify({
    lessonId: '   ',
    cards: [{ front: 'ignored', back: 'ignored' }]
  }), 'utf8')
  await writeFile(join(rootPath, 'lessons', 'empty-card-flashcards.json'), JSON.stringify({
    lessonId: 'ignored',
    cards: [{ front: '  ', back: 'answer' }, { front: 'question', back: ' ' }]
  }), 'utf8')
  await writeFile(join(rootPath, '.studiumx', 'progress.json'), JSON.stringify({
    totalAnswered: 999,
    correct: 999,
    byLesson: {
      'lesson-alpha': { answered: '4', correct: '3' },
      legacy: { answered: 2, correct: 1 },
      malformed: { answered: -1, correct: 9 }
    }
  }), 'utf8')

  const deck = new TeachingWorkspaceReviewDeck()
  const first = await deck.loadDeck(workspace)
  assert.equal(first.cards.length, 5, 'valid cards in supported durable roots should load')
  assert.deepEqual(first.progress, {
    totalAnswered: 6,
    correct: 4,
    byLesson: {
      legacy: { answered: 2, correct: 1 },
      'lesson-alpha': { answered: 4, correct: 3 },
      malformed: { answered: 0, correct: 0 }
    }
  }, 'legacy lesson buckets should remain readable while stale root totals are ignored')

  const alphaCards = first.cards.filter((card) => card.lessonId === 'lesson-alpha')
  assert.equal(alphaCards.length, 4)
  assert.equal(alphaCards[0].lessonTitle, 'Alpha lesson')
  assert.equal(alphaCards[0].provenance.artifactPath, 'courses/demo/lesson/0001-alpha-flashcards.json')
  assert.equal(alphaCards[0].provenance.artifactCardIndex, 0)
  const betaCard = first.cards.find((card) => card.lessonId === 'lesson-beta')
  assert.ok(betaCard)
  assert.equal(betaCard.lessonTitle, 'lesson-beta', 'missing durable title should fall back to the lesson id')
  assert.equal(betaCard.provenance.artifactCardId, 'beta-card')
  assert.match(betaCard.id, /^review-card-[a-f0-9]{64}$/)
  const twinIds = alphaCards.filter((card) => card.front === 'Twin').map((card) => card.id)
  assert.equal(new Set(twinIds).size, 2, 'identical cards should retain distinct deterministic identities')

  const idsByFront = new Map(first.cards.map((card) => [card.front, card.id]))
  await writeFile(alphaArtifact, JSON.stringify({
    lessonId: ' lesson-alpha ',
    lessonTitle: ' Alpha lesson ',
    cards: [
      { front: 'Term B', back: 'Definition B' },
      { front: 'Term A', back: 'Definition A' },
      { front: 'Twin', back: 'Same answer' },
      { front: 'Twin', back: 'Same answer' }
    ]
  }), 'utf8')
  const reordered = await deck.loadDeck(workspace)
  assert.equal(reordered.cards.find((card) => card.front === 'Term A')?.id, idsByFront.get('Term A'))
  assert.equal(reordered.cards.find((card) => card.front === 'Term B')?.id, idsByFront.get('Term B'))

  const recorded = await deck.recordAttempt(workspace, {
    workspaceId: workspace.id,
    lessonId: 'lesson-alpha',
    results: [
      { lessonId: 'lesson-alpha', question: 'Term A', correct: true },
      { lessonId: 'lesson-beta', question: 'Term B', correct: false },
      { lessonId: 'lesson-alpha', question: 'legacy question not in the deck', correct: false }
    ]
  })
  assert.deepEqual(recorded.progress, {
    totalAnswered: 9,
    correct: 5,
    byLesson: {
      legacy: { answered: 2, correct: 1 },
      'lesson-alpha': { answered: 7, correct: 4 },
      malformed: { answered: 0, correct: 0 }
    }
  }, 'attempt aggregation must keep the existing payload.lessonId semantics, including unmatched questions')

  const durableProgress = JSON.parse(await readFile(join(rootPath, '.studiumx', 'progress.json'), 'utf8'))
  assert.equal(durableProgress.version, 2)
  assert.equal(durableProgress.totalAnswered, 9)
  assert.equal(durableProgress.correct, 5)
  assert.deepEqual(durableProgress.byLesson['lesson-alpha'], { answered: 7, correct: 4 })
  assert.deepEqual(durableProgress.byCard[idsByFront.get('Term A')!], { answered: 1, correct: 1 })
  assert.deepEqual(durableProgress.byCard[idsByFront.get('Term B')!], { answered: 1, correct: 0 })
  assert.equal(Object.keys(durableProgress.byCard).length, 2, 'unmatched legacy questions should not lose their lesson-level attempt')

  const reloaded = await deck.loadDeck(workspace)
  assert.deepEqual(reloaded.progress, recorded.progress, 'versioned durable progress should remain readable through the legacy summary adapter')

  console.log('teaching workspace review deck ok')
} finally {
  if (rootPath) await rm(rootPath, { recursive: true, force: true })
}
