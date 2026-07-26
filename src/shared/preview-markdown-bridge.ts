import {
  type LessonInteraction,
  type PreviewLessonInteractionIntent,
  normalizeLessonInteraction,
  normalizePreviewLessonInteractionIntent
} from './teaching-types/lesson-interaction'
import { normalizeFillAnswer, sha256HexUtf8 } from './fill-answer'
import { EXTERNAL_DESTINATION_PROTOCOLS, classifyExternalDestination } from './external-destination'

export type { PreviewLessonInteractionIntent } from './teaching-types/lesson-interaction'

export const PREVIEW_PROTOCOL = 'studiumx-preview'
export const PREVIEW_MARKDOWN_LINK_MESSAGE = 'studiumx:open-markdown'
export const PREVIEW_EXTERNAL_LINK_MESSAGE = 'studiumx:open-external'
export const PREVIEW_LESSON_INTERACTION_MESSAGE = 'studiumx:lesson-interaction'
export const PREVIEW_LESSON_INTERACTION_SOURCE = 'studiumx-lesson-evidence'
export const MARKDOWN_LESSON_INTERACTION_PROTOCOL = 'studiumx-evidence'

const BRIDGE_SCRIPT_ID = 'studiumx-markdown-link-bridge'
export const PREVIEW_SCROLLBAR_STYLE_ID = 'studiumx-preview-scrollbar-style'

export type PreviewMarkdownLink = {
  workspaceId: string
  relativePath: string
}

/** Trusted host binding. Untrusted preview messages cannot supply these values. */
export type LessonInteractionRecordingContext = {
  workspaceId: string
  courseId: string
  sessionId: string
  lessonId: string
  artifactDigest: string
  observedAt: string
  attempt?: number
  surface?: 'lesson_preview' | 'markdown_preview'
}

function markdownBridgeScript(): string {
  return `<script id="${BRIDGE_SCRIPT_ID}">
(() => {
  if (window.__studiumxMarkdownLinkBridge) return;
  window.__studiumxMarkdownLinkBridge = true;
  let interactionSequence = 0;
  const stableId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value !== '.' && value !== '..';
  const interactionId = (kind, index) => 'preview-' + kind + '-' + index + '-' + Date.now() + '-' + (++interactionSequence);
  const emit = (interaction) => {
    if (!interaction || !stableId(interaction.eventId) || !stableId(interaction.itemId)) return;
    window.parent.postMessage({ source: ${JSON.stringify(PREVIEW_LESSON_INTERACTION_SOURCE)}, type: ${JSON.stringify(PREVIEW_LESSON_INTERACTION_MESSAGE)}, interaction }, '*');
  };
  const itemIndex = (selector, node) => Math.max(0, Array.from(document.querySelectorAll(selector)).indexOf(node)) + 1;
  // ADR-0155: fill answers digest to safe option ids; same normalization as quiz.js.
  const normalizeFill = ${String(normalizeFillAnswer)};
  const sha256Hex = ${String(sha256HexUtf8)};
  const emitFillSubmission = (card) => {
    queueMicrotask(() => {
      const input = card.querySelector('input[type="text"]');
      const value = input && typeof input.value === 'string' ? input.value : '';
      const normalized = normalizeFill(value);
      if (!normalized) return;
      const primary = normalizeFill(card.getAttribute('data-answer') || '');
      let acceptedRaw = [];
      try { acceptedRaw = JSON.parse(card.getAttribute('data-accepted') || '[]'); } catch {}
      const accepted = [primary]
        .concat(Array.isArray(acceptedRaw) ? acceptedRaw.map((entry) => normalizeFill(String(entry))) : [])
        .filter(Boolean);
      const correct = accepted.includes(normalized);
      const index = itemIndex('.quiz-card', card);
      emit({
        eventId: interactionId('quiz', index),
        kind: 'quiz_answered',
        itemId: 'quiz-' + index,
        selectedOptionIds: ['fill-' + sha256Hex(normalized)],
        correct
      });
    });
  };
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const explicit = target.closest('[data-lesson-evidence]');
    if (explicit) {
      const kind = explicit.getAttribute('data-lesson-evidence');
      const itemId = explicit.getAttribute('data-item-id');
      const eventId = explicit.getAttribute('data-evidence-id');
      if (!stableId(eventId) || !stableId(itemId)) return;
      if (kind === 'quiz_answered') emit({ eventId, kind, itemId, selectedOptionIds: [explicit.getAttribute('data-option-id') || 'selected'], correct: explicit.getAttribute('data-correct') === 'true' });
      if (kind === 'flashcard_rated') emit({ eventId, kind, itemId, rating: explicit.getAttribute('data-rating') });
      return;
    }
    const choice = target.closest('.quiz-card button[data-choice]');
    if (choice) {
      const card = choice.closest('.quiz-card');
      if (!card) return;
      const type = card.getAttribute('data-type') || 'single';
      if (type === 'fill') {
        if (choice.getAttribute('data-choice') === 'submit') emitFillSubmission(card);
        return;
      }
      queueMicrotask(() => {
        const itemId = 'quiz-' + itemIndex('.quiz-card', card);
        const answer = card.getAttribute('data-answer') || '';
        const selected = Array.from(card.querySelectorAll('button[data-choice].is-selected')).map((button) => button.getAttribute('data-choice')).filter(Boolean);
        const optionId = choice.getAttribute('data-choice');
        const selectedOptionIds = type === 'multi' ? selected : optionId ? [optionId] : [];
        const expected = answer.split(',').map((value) => value.trim()).filter(Boolean);
        const correct = type === 'multi'
          ? selectedOptionIds.length === expected.length && selectedOptionIds.every((value) => expected.includes(value))
          : selectedOptionIds.length === 1 && selectedOptionIds[0] === answer;
        emit({ eventId: interactionId('quiz', itemIndex('.quiz-card', card)), kind: 'quiz_answered', itemId, selectedOptionIds, correct });
      });
      return;
    }
    const rating = target.closest('button[data-rating]');
    if (rating) {
      const card = rating.closest('.flashcard');
      if (!card) return;
      emit({ eventId: interactionId('flashcard', itemIndex('.flashcard', card)), kind: 'flashcard_rated', itemId: 'flashcard-' + itemIndex('.flashcard', card), rating: rating.getAttribute('data-rating') });
    }
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const target = event.target instanceof Element ? event.target : null;
    const input = target && target.closest ? target.closest('.quiz-card input[type="text"]') : null;
    if (!input) return;
    const card = input.closest('.quiz-card');
    if (!card || (card.getAttribute('data-type') || '') !== 'fill') return;
    emitFillSubmission(card);
  }, true);
  document.addEventListener('click', (event) => {
    const target = event.target;
    const anchor = target instanceof Element ? target.closest('a[href]') : null;
    if (!anchor) return;
    let url;
    try {
      url = new URL(anchor.href || anchor.getAttribute('href') || '', window.location.href);
    } catch {
      return;
    }
    if (url.protocol === ${JSON.stringify(`${PREVIEW_PROTOCOL}:`)}) {
      const path = decodeURIComponent(url.pathname);
      if (!/\\.(?:md|markdown)$/i.test(path)) return;
      event.preventDefault();
      window.parent.postMessage({ type: ${JSON.stringify(PREVIEW_MARKDOWN_LINK_MESSAGE)}, href: url.href }, '*');
      return;
    }
    if (${JSON.stringify(EXTERNAL_DESTINATION_PROTOCOLS)}.includes(url.protocol)) {
      event.preventDefault();
      window.parent.postMessage({ type: ${JSON.stringify(PREVIEW_EXTERNAL_LINK_MESSAGE)}, href: url.href }, '*');
    }
  }, true);
})();
</script>`
}

export function injectPreviewMarkdownLinkBridge(html: string): string {
  if (html.includes(`id="${BRIDGE_SCRIPT_ID}"`)) return html
  const script = markdownBridgeScript()
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}\n</body>`)
  return `${html}\n${script}`
}

/** Keep scrollbar tracks invisible inside untrusted HTML lesson iframes. */
export function injectPreviewTransparentScrollbarStyle(html: string): string {
  if (html.includes(`id="${PREVIEW_SCROLLBAR_STYLE_ID}"`)) return html
  const style = `<style id="${PREVIEW_SCROLLBAR_STYLE_ID}">
:root {
  --studiumx-preview-scrollbar-thumb: rgba(104, 119, 143, 0.38);
  --studiumx-preview-scrollbar-thumb-hover: rgba(104, 119, 143, 0.56);
}
* {
  scrollbar-color: var(--studiumx-preview-scrollbar-thumb) transparent !important;
  scrollbar-width: thin;
}
*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
  background: transparent !important;
  box-shadow: none !important;
}
*::-webkit-scrollbar-thumb {
  border: 2px solid transparent !important;
  border-radius: 999px;
  background: var(--studiumx-preview-scrollbar-thumb);
}
*::-webkit-scrollbar-thumb:hover {
  background: var(--studiumx-preview-scrollbar-thumb-hover);
}
</style>`
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${style}\n</body>`)
  return `${html}\n${style}`
}

export function ensurePreviewBaseTag(html: string, baseHref: string): string {
  if (/<base\s/i.test(html)) return html
  return html.replace(/<head([^>]*)>/i, `<head$1>\n  <base href="${escapeHtmlAttribute(baseHref)}" />`)
}

export function parsePreviewMarkdownHref(href: string): PreviewMarkdownLink | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== `${PREVIEW_PROTOCOL}:`) return null

  const workspaceId = decodeURIComponent(url.hostname)
  const relativePath = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
    .join('/')

  if (!workspaceId || !relativePath || !/\.(?:md|markdown)$/i.test(relativePath)) return null
  return { workspaceId, relativePath }
}

/** Parse the narrow event message emitted by an untrusted iframe preview. */
export function parsePreviewLessonInteractionMessage(value: unknown): PreviewLessonInteractionIntent | null {
  if (!isRecord(value) || !hasExactKeys(value, ['source', 'type', 'interaction'])) return null
  if (value.source !== PREVIEW_LESSON_INTERACTION_SOURCE || value.type !== PREVIEW_LESSON_INTERACTION_MESSAGE) return null
  try {
    return normalizePreviewLessonInteractionIntent(value.interaction)
  } catch {
    return null
  }
}

/** Parse the markdown-preview link grammar; no path, workspace, or Session ID can appear in it. */
export function parseMarkdownLessonInteractionHref(href: string): PreviewLessonInteractionIntent | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== `${MARKDOWN_LESSON_INTERACTION_PROTOCOL}:`) return null
  const [eventId, itemId, ...rest] = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  if (rest.length > 0 || !eventId || !itemId) return null
  const kind = url.hostname
  const query = [...url.searchParams.keys()].sort()
  const raw: Record<string, unknown> = { eventId, kind, itemId }
  if (kind === 'quiz_answered') {
    if (query.join(',') !== 'correct,option') return null
    raw.selectedOptionIds = [url.searchParams.get('option')]
    raw.correct = url.searchParams.get('correct') === 'true'
  } else if (kind === 'flashcard_rated') {
    if (query.join(',') !== 'rating') return null
    raw.rating = url.searchParams.get('rating')
  } else if (kind === 'lesson_opened' || kind === 'lesson_completed') {
    if (query.length > 0) return null
  } else if (kind === 'retrieval_response_submitted' || kind === 'learner_response_recorded') {
    if (query.join(',') !== 'responseDigest,responseKind') return null
    raw.responseDigest = url.searchParams.get('responseDigest')
    raw.responseKind = url.searchParams.get('responseKind')
  } else {
    return null
  }
  try {
    return normalizePreviewLessonInteractionIntent(raw)
  } catch {
    return null
  }
}

/** Bind an allowlisted preview intent to host-owned Session identity and provenance. */
export function createPreviewLessonInteraction(
  context: LessonInteractionRecordingContext,
  intent: PreviewLessonInteractionIntent
): LessonInteraction {
  const normalizedIntent = normalizePreviewLessonInteractionIntent(intent)
  const shared = {
    schemaVersion: 1 as const,
    workspaceId: context.workspaceId,
    courseId: context.courseId,
    sessionId: context.sessionId,
    lessonId: context.lessonId,
    artifactDigest: context.artifactDigest,
    observedAt: context.observedAt,
    attempt: context.attempt ?? 1,
    surface: context.surface ?? 'lesson_preview'
  }
  switch (normalizedIntent.kind) {
    case 'lesson_opened':
    case 'lesson_completed':
      return normalizeLessonInteraction({ ...shared, ...normalizedIntent })
    case 'quiz_answered':
    case 'flashcard_rated':
      return normalizeLessonInteraction({ ...shared, ...normalizedIntent })
    case 'retrieval_response_submitted':
    case 'learner_response_recorded':
      return normalizeLessonInteraction({ ...shared, ...normalizedIntent })
  }
}

/** Browser-message adapter for the same external destination allowlist used before Electron opens it. */
export function parsePreviewExternalHref(href: string): string | null {
  const target = classifyExternalDestination(href)
  return target.kind === 'browser' ? target.url : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
