import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ProgressSummary,
  RecordProgressPayload,
  ReviewCard
} from '../../shared/teaching-types'
import { collectTeachingFiles, toWorkspaceRelativePath } from '../teaching-workspace-paths'
import { atomicWriteFile } from './lifecycle'

export type ReviewWorkspace = {
  id: string
  rootPath: string
}

export type LoadedReviewDeck = {
  cards: ReviewCard[]
  progress: ProgressSummary
}

type ProgressBucket = { answered: number; correct: number }

type DurableReviewProgress = {
  byLesson: ProgressSummary['byLesson']
  byCard: Record<string, ProgressBucket>
}

type LoadedReviewDeckState = LoadedReviewDeck & {
  durableProgress: DurableReviewProgress
}

/**
 * The durable review-deck seam. It adapts lesson flashcard artifacts and the
 * legacy `.studiumx/progress.json` document behind two operations: load a deck
 * and record an attempt. Callers never need to discover, validate, identify,
 * or aggregate durable review records themselves.
 */
export class TeachingWorkspaceReviewDeck {
  async loadDeck(workspace: ReviewWorkspace): Promise<LoadedReviewDeck> {
    const deck = await this.loadDeckState(workspace)
    return { cards: deck.cards, progress: deck.progress }
  }

  async recordAttempt(workspace: ReviewWorkspace, payload: RecordProgressPayload): Promise<LoadedReviewDeck> {
    const deck = await this.loadDeckState(workspace)
    const durableProgress = addAttempt(deck.durableProgress, deck.cards, payload)
    const progress = summarizeProgress(durableProgress.byLesson)
    await atomicWriteFile(this.progressPath(workspace), `${JSON.stringify({
      version: 2,
      ...progress,
      byCard: durableProgress.byCard
    }, null, 2)}\n`)
    return { cards: deck.cards, progress }
  }

  private async loadDeckState(workspace: ReviewWorkspace): Promise<LoadedReviewDeckState> {
    const [cards, durableProgress] = await Promise.all([
      this.readCards(workspace),
      this.readProgressFile(this.progressPath(workspace))
    ])
    return {
      cards,
      durableProgress,
      progress: summarizeProgress(durableProgress.byLesson)
    }
  }

  private async readCards(workspace: ReviewWorkspace): Promise<ReviewCard[]> {
    const artifactPaths = (await collectTeachingFiles(
      workspace.rootPath,
      (file) => file.toLowerCase().endsWith('-flashcards.json')
    ))
      .map((filePath) => ({
        filePath,
        relativePath: toWorkspaceRelativePath(workspace.rootPath, filePath)
      }))
      .sort((left, right) => compareText(left.relativePath, right.relativePath))

    const cards: ReviewCard[] = []
    for (const artifact of artifactPaths) {
      const parsed = safeJsonParse(await readFile(artifact.filePath, 'utf8').catch(() => ''))
      const document = asRecord(parsed)
      const lessonId = nonEmptyText(document?.lessonId)
      const cardList = document?.cards
      if (!lessonId || !Array.isArray(cardList)) continue

      const lessonTitle = nonEmptyText(document?.lessonTitle) ?? lessonId
      const duplicateOccurrences = new Map<string, number>()
      for (const [artifactCardIndex, item] of cardList.entries()) {
        const sourceCard = asRecord(item)
        const front = nonEmptyText(sourceCard?.front)
        const back = nonEmptyText(sourceCard?.back)
        if (!front || !back) continue

        const artifactCardId = nonEmptyText(sourceCard?.id)
        const identitySeed = [
          artifact.relativePath,
          lessonId,
          artifactCardId ? `id:${artifactCardId}` : `content:${normalizeIdentityText(front)}\n${normalizeIdentityText(back)}`
        ].join('\n')
        const duplicateOccurrence = duplicateOccurrences.get(identitySeed) ?? 0
        duplicateOccurrences.set(identitySeed, duplicateOccurrence + 1)

        cards.push({
          id: stableCardId(identitySeed, duplicateOccurrence),
          lessonId,
          lessonTitle,
          front,
          back,
          provenance: {
            artifactPath: artifact.relativePath,
            artifactCardIndex,
            ...(artifactCardId ? { artifactCardId } : {})
          }
        })
      }
    }
    return cards
  }

  private progressPath(workspace: ReviewWorkspace): string {
    return join(workspace.rootPath, '.studiumx', 'progress.json')
  }

  private async readProgressFile(progressPath: string): Promise<DurableReviewProgress> {
    const parsed = asRecord(safeJsonParse(await readFile(progressPath, 'utf8').catch(() => '')))
    return {
      byLesson: readProgressBuckets(parsed?.byLesson),
      byCard: readProgressBuckets(parsed?.byCard)
    }
  }
}

function addAttempt(
  existing: DurableReviewProgress,
  cards: ReviewCard[],
  payload: RecordProgressPayload
): DurableReviewProgress {
  const byLesson = { ...existing.byLesson }
  const byCard = { ...existing.byCard }
  const prior = byLesson[payload.lessonId] ?? { answered: 0, correct: 0 }
  byLesson[payload.lessonId] = {
    answered: prior.answered + payload.results.length,
    correct: prior.correct + payload.results.filter((result) => result.correct).length
  }

  const cardsByQuestion = new Map<string, ReviewCard[]>()
  for (const card of cards) {
    if (card.lessonId !== payload.lessonId) continue
    const matches = cardsByQuestion.get(card.front) ?? []
    matches.push(card)
    cardsByQuestion.set(card.front, matches)
  }
  const matchedQuestionOccurrences = new Map<string, number>()
  for (const result of payload.results) {
    const matches = cardsByQuestion.get(result.question)
    if (!matches?.length) continue
    const occurrence = matchedQuestionOccurrences.get(result.question) ?? 0
    matchedQuestionOccurrences.set(result.question, occurrence + 1)
    const card = matches[occurrence % matches.length]
    const priorCard = byCard[card.id] ?? { answered: 0, correct: 0 }
    byCard[card.id] = {
      answered: priorCard.answered + 1,
      correct: priorCard.correct + (result.correct ? 1 : 0)
    }
  }
  return { byLesson, byCard }
}

function summarizeProgress(byLesson: ProgressSummary['byLesson']): ProgressSummary {
  const normalizedByLesson = Object.fromEntries(
    Object.entries(byLesson)
      .map(([lessonId, progress]) => [lessonId, sanitizeBucket(progress)] as const)
      .sort(([left], [right]) => compareText(left, right))
  )
  return {
    totalAnswered: Object.values(normalizedByLesson).reduce((sum, entry) => sum + entry.answered, 0),
    correct: Object.values(normalizedByLesson).reduce((sum, entry) => sum + entry.correct, 0),
    byLesson: normalizedByLesson
  }
}

function readProgressBuckets(value: unknown): Record<string, ProgressBucket> {
  const record = asRecord(value)
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, bucket]) => {
      const normalizedKey = nonEmptyText(key)
      return normalizedKey ? [[normalizedKey, sanitizeBucket(bucket)]] : []
    })
  )
}

function sanitizeBucket(value: unknown): ProgressBucket {
  const record = asRecord(value)
  const answered = finiteNonNegative(record?.answered)
  return {
    answered,
    correct: Math.min(answered, finiteNonNegative(record?.correct))
  }
}

function finiteNonNegative(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeIdentityText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function stableCardId(seed: string, duplicateOccurrence: number): string {
  return `review-card-${createHash('sha256').update(`${seed}\n${duplicateOccurrence}`).digest('hex')}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
