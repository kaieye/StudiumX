import { DEFAULT_PET_SIZE, MAX_PET_SIZE, MIN_PET_SIZE } from '../../../../shared/teaching-types'

/**
 * Pure interaction policy for the floating pet surfaces.
 *
 * React owns state, DOM measurements, pointer capture, and browser storage. This
 * module owns the values and transitions those adapters apply.
 */
export const PET_POSITION_STORAGE_KEY = 'studiumx-pet-position-v1'
export const PET_ASSISTANT_GEOMETRY_STORAGE_KEY = 'studiumx-pet-assistant-geometry-v1'

const PET_EDGE_GAP = 14
const PET_DEFAULT_WIDTH = 150
const PET_DEFAULT_HEIGHT = 130
const PET_DRAG_THRESHOLD = 4
const PET_CONTEXT_MENU_GAP = 8
const PET_CONTEXT_MENU_WIDTH = 196
const PET_CONTEXT_MENU_HEIGHT = 192
const PET_BUBBLE_VIEWPORT_GAP = 12
const PET_BUBBLE_ANCHOR_GAP = 8
const ASSISTANT_EDGE_GAP = 16
const ASSISTANT_MIN_WIDTH = 300
const ASSISTANT_MIN_HEIGHT = 320
const ASSISTANT_DEFAULT_WIDTH = 380
const ASSISTANT_DEFAULT_HEIGHT = 560

export type PetPoint = { x: number; y: number }
export type PetPlacement = PetPoint
export type FloatingSurfaceSize = { width: number; height: number }
export type InteractionViewport = { width: number; height: number }
export type FloatingSurfaceRect = PetPlacement & FloatingSurfaceSize
export type PetBubbleLayout = FloatingSurfaceRect & {
  maxWidth: number
  maxHeight: number
  horizontal: 'start' | 'center' | 'end'
  vertical: 'above' | 'below'
}
export type PetActivityNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
export type AssistantDialogGeometry = PetPlacement & FloatingSurfaceSize
export type AssistantDialogResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw'
export type AssistantDialogInteractionMode = 'drag' | 'resize'

export type PetDragSession = {
  pointerId: number
  startPoint: PetPoint
  lastPoint: PetPoint
  startPlacement: PetPlacement
  direction: 'left' | 'right' | null
  moved: boolean
}

export type PetResizeSession = {
  pointerId: number
  startX: number
  startSize: number
  size: number
  moved: boolean
}

export type AssistantDialogInteraction = {
  pointerId: number
  mode: AssistantDialogInteractionMode
  direction?: AssistantDialogResizeDirection
  startPoint: PetPoint
  startGeometry: AssistantDialogGeometry
}

export type PetAttentionState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function safeParse(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function assistantAvailableSize(viewport: InteractionViewport): FloatingSurfaceSize {
  return {
    width: Math.max(1, viewport.width - ASSISTANT_EDGE_GAP * 2),
    height: Math.max(1, viewport.height - ASSISTANT_EDGE_GAP * 2)
  }
}

export function parseStoredPetPlacement(value: string | null): PetPlacement | null {
  const candidate = safeParse(value)
  if (!isRecord(candidate) || !isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) return null
  return { x: candidate.x, y: candidate.y }
}

export function serializePetPlacement(placement: PetPlacement): string {
  return JSON.stringify(placement)
}

export function clampPetPlacement(
  placement: PetPlacement,
  viewport: InteractionViewport,
  size: FloatingSurfaceSize = { width: PET_DEFAULT_WIDTH, height: PET_DEFAULT_HEIGHT }
): PetPlacement {
  return {
    x: clamp(placement.x, PET_EDGE_GAP, Math.max(PET_EDGE_GAP, viewport.width - size.width - PET_EDGE_GAP)),
    y: clamp(placement.y, PET_EDGE_GAP, Math.max(PET_EDGE_GAP, viewport.height - size.height - PET_EDGE_GAP))
  }
}

export function resolvePetBubbleLayout(
  anchor: FloatingSurfaceRect,
  bubble: FloatingSurfaceSize,
  viewport: InteractionViewport
): PetBubbleLayout {
  const maxWidth = Math.max(1, viewport.width - PET_BUBBLE_VIEWPORT_GAP * 2)
  const maxHeight = Math.max(1, viewport.height - PET_BUBBLE_VIEWPORT_GAP * 2)
  const width = Math.min(Math.max(1, bubble.width), maxWidth)
  const height = Math.min(Math.max(1, bubble.height), maxHeight)
  const preferredX = anchor.x + anchor.width / 2 - width / 2
  const maximumX = Math.max(PET_BUBBLE_VIEWPORT_GAP, viewport.width - PET_BUBBLE_VIEWPORT_GAP - width)
  const x = clamp(preferredX, PET_BUBBLE_VIEWPORT_GAP, maximumX)
  const horizontal = preferredX < x
    ? 'start'
    : preferredX > x
      ? 'end'
      : 'center'
  const aboveSpace = anchor.y - PET_BUBBLE_VIEWPORT_GAP - PET_BUBBLE_ANCHOR_GAP
  const belowSpace = viewport.height - PET_BUBBLE_VIEWPORT_GAP - anchor.y - anchor.height - PET_BUBBLE_ANCHOR_GAP
  const vertical = height <= aboveSpace
    ? 'above'
    : height <= belowSpace
      ? 'below'
      : aboveSpace >= belowSpace
        ? 'above'
        : 'below'
  const preferredY = vertical === 'above'
    ? anchor.y - PET_BUBBLE_ANCHOR_GAP - height
    : anchor.y + anchor.height + PET_BUBBLE_ANCHOR_GAP
  const maximumY = Math.max(PET_BUBBLE_VIEWPORT_GAP, viewport.height - PET_BUBBLE_VIEWPORT_GAP - height)

  return {
    x,
    y: clamp(preferredY, PET_BUBBLE_VIEWPORT_GAP, maximumY),
    width,
    height,
    maxWidth,
    maxHeight,
    horizontal,
    vertical
  }
}

export function resolvePetActivityNavigation(
  notificationIds: readonly string[],
  currentId: string | null,
  key: PetActivityNavigationKey
): string | null {
  if (notificationIds.length === 0) return null
  if (key === 'Home') return notificationIds[0]
  if (key === 'End') return notificationIds[notificationIds.length - 1]
  const currentIndex = currentId ? notificationIds.indexOf(currentId) : -1
  if (currentIndex < 0) return key === 'ArrowDown' ? notificationIds[0] : notificationIds[notificationIds.length - 1]
  const direction = key === 'ArrowDown' ? 1 : -1
  return notificationIds[(currentIndex + direction + notificationIds.length) % notificationIds.length]
}

export function resolvePetActivityFocusAfterRemoval(
  previousIds: readonly string[],
  nextIds: readonly string[],
  focusedId: string | null
): string | null {
  if (nextIds.length === 0) return null
  if (focusedId && nextIds.includes(focusedId)) return focusedId
  const previousIndex = focusedId ? previousIds.indexOf(focusedId) : -1
  if (previousIndex < 0) return nextIds[0]
  return nextIds[Math.min(previousIndex, nextIds.length - 1)]
}

export function startPetDrag(
  pointerId: number,
  startPoint: PetPoint,
  startPlacement: PetPlacement
): PetDragSession {
  return {
    pointerId,
    startPoint,
    lastPoint: startPoint,
    startPlacement,
    direction: null,
    moved: false
  }
}

export function movePetDrag(
  session: PetDragSession,
  pointerId: number,
  point: PetPoint,
  viewport: InteractionViewport,
  size: FloatingSurfaceSize
): { session: PetDragSession; placement: PetPlacement | null; direction: 'left' | 'right' | null } {
  if (session.pointerId !== pointerId) return { session, placement: null, direction: null }

  const dx = point.x - session.startPoint.x
  const dy = point.y - session.startPoint.y
  const instantDx = point.x - session.lastPoint.x
  const moved = session.moved || Math.hypot(dx, dy) >= PET_DRAG_THRESHOLD
  const direction = instantDx < 0
    ? 'left'
    : instantDx > 0
      ? 'right'
      : session.direction
  const nextSession = { ...session, lastPoint: point, moved, direction }
  if (!moved) return { session: nextSession, placement: null, direction: null }

  return {
    session: nextSession,
    placement: clampPetPlacement(
      { x: session.startPlacement.x + dx, y: session.startPlacement.y + dy },
      viewport,
      size
    ),
    direction
  }
}

export function finishPetDrag(
  session: PetDragSession,
  pointerId: number
): 'ignore' | 'persist-placement' | 'activate-assistant' {
  if (session.pointerId !== pointerId) return 'ignore'
  return session.moved ? 'persist-placement' : 'activate-assistant'
}

export function cancelPetDrag(
  session: PetDragSession,
  pointerId: number
): 'ignore' | 'persist-placement' | 'cancel-activation' {
  if (session.pointerId !== pointerId) return 'ignore'
  return session.moved ? 'persist-placement' : 'cancel-activation'
}

export function clampPetSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_PET_SIZE
  return Math.round(clamp(size, MIN_PET_SIZE, MAX_PET_SIZE))
}

export function petSurfaceSize(size: number): FloatingSurfaceSize {
  const width = clampPetSize(size)
  return {
    width: width + 12,
    height: Math.round((width * 208) / 192) + 12
  }
}

export function startPetResize(pointerId: number, startX: number, startSize: number): PetResizeSession {
  const size = clampPetSize(startSize)
  return { pointerId, startX, startSize: size, size, moved: false }
}

export function movePetResize(
  session: PetResizeSession,
  pointerId: number,
  currentX: number
): { session: PetResizeSession; size: number | null } {
  if (session.pointerId !== pointerId) return { session, size: null }
  const delta = session.startX - currentX
  const size = clampPetSize(session.startSize + delta)
  const nextSession = {
    ...session,
    size,
    moved: session.moved || Math.abs(delta) >= 1
  }
  return { session: nextSession, size }
}

export function finishPetResize(
  session: PetResizeSession,
  pointerId: number
): { outcome: 'ignore' | 'no-change' | 'persist-size'; size: number } {
  if (session.pointerId !== pointerId) return { outcome: 'ignore', size: session.size }
  return {
    outcome: session.moved && session.size !== session.startSize ? 'persist-size' : 'no-change',
    size: session.size
  }
}

export function derivePetAttention(input: {
  notificationState: Exclude<PetAttentionState, 'idle' | 'running-right' | 'running-left' | 'jumping'> | null
  hovered: boolean
  dragDirection: 'left' | 'right' | null
  showStatusBubble: boolean
}): { baseState: PetAttentionState; visualState: PetAttentionState; showBubble: boolean } {
  const baseState: PetAttentionState = input.notificationState ?? 'idle'
  const visualState: PetAttentionState = input.dragDirection
    ? `running-${input.dragDirection}`
    : input.hovered && baseState === 'idle'
      ? 'jumping'
      : baseState

  return { baseState, visualState, showBubble: input.showStatusBubble && baseState !== 'idle' }
}

export function clampPetContextMenuPlacement(
  placement: PetPlacement,
  viewport: InteractionViewport
): PetPlacement {
  return {
    x: clamp(
      placement.x,
      PET_CONTEXT_MENU_GAP,
      Math.max(PET_CONTEXT_MENU_GAP, viewport.width - PET_CONTEXT_MENU_WIDTH - PET_CONTEXT_MENU_GAP)
    ),
    y: clamp(
      placement.y,
      PET_CONTEXT_MENU_GAP,
      Math.max(PET_CONTEXT_MENU_GAP, viewport.height - PET_CONTEXT_MENU_HEIGHT - PET_CONTEXT_MENU_GAP)
    )
  }
}

export function shouldDismissPetContextMenu(input: {
  reason: 'outside-pointer' | 'escape' | 'scroll' | 'viewport-change' | 'window-blur'
  pointerIsInsideMenu?: boolean
}): boolean {
  return input.reason !== 'outside-pointer' || !input.pointerIsInsideMenu
}

export function shouldRestorePetFocusAfterContextMenuDismissal(reason: 'escape' | 'outside-pointer' | 'scroll' | 'viewport-change' | 'window-blur'): boolean {
  return reason === 'escape'
}

export function parseStoredAssistantDialogGeometry(value: string | null): AssistantDialogGeometry | null {
  const candidate = safeParse(value)
  if (
    !isRecord(candidate) ||
    !isFiniteNumber(candidate.x) ||
    !isFiniteNumber(candidate.y) ||
    !isFiniteNumber(candidate.width) ||
    !isFiniteNumber(candidate.height)
  ) return null
  return { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height }
}

export function serializeAssistantDialogGeometry(geometry: AssistantDialogGeometry): string {
  return JSON.stringify(geometry)
}

export function clampAssistantDialogGeometry(
  geometry: AssistantDialogGeometry,
  viewport: InteractionViewport
): AssistantDialogGeometry {
  const available = assistantAvailableSize(viewport)
  const minimumWidth = Math.min(ASSISTANT_MIN_WIDTH, available.width)
  const minimumHeight = Math.min(ASSISTANT_MIN_HEIGHT, available.height)
  const width = clamp(geometry.width, minimumWidth, available.width)
  const height = clamp(geometry.height, minimumHeight, available.height)

  return {
    x: clamp(geometry.x, ASSISTANT_EDGE_GAP, Math.max(ASSISTANT_EDGE_GAP, viewport.width - width - ASSISTANT_EDGE_GAP)),
    y: clamp(geometry.y, ASSISTANT_EDGE_GAP, Math.max(ASSISTANT_EDGE_GAP, viewport.height - height - ASSISTANT_EDGE_GAP)),
    width,
    height
  }
}

export function defaultAssistantDialogGeometry(viewport: InteractionViewport): AssistantDialogGeometry {
  const available = assistantAvailableSize(viewport)
  const width = Math.min(ASSISTANT_DEFAULT_WIDTH, available.width)
  const height = Math.min(ASSISTANT_DEFAULT_HEIGHT, available.height)
  return clampAssistantDialogGeometry({ x: viewport.width - width - ASSISTANT_EDGE_GAP, y: viewport.height - height - ASSISTANT_EDGE_GAP, width, height }, viewport)
}

export function startAssistantDialogInteraction(input: {
  pointerId: number
  mode: AssistantDialogInteractionMode
  direction?: AssistantDialogResizeDirection
  startPoint: PetPoint
  startGeometry: AssistantDialogGeometry
}): AssistantDialogInteraction {
  return input
}

export function projectAssistantDialogInteraction(
  interaction: AssistantDialogInteraction,
  pointerId: number,
  point: PetPoint,
  viewport: InteractionViewport
): AssistantDialogGeometry | null {
  if (interaction.pointerId !== pointerId) return null
  const dx = point.x - interaction.startPoint.x
  const dy = point.y - interaction.startPoint.y
  const start = interaction.startGeometry

  if (interaction.mode === 'drag') {
    return clampAssistantDialogGeometry({ ...start, x: start.x + dx, y: start.y + dy }, viewport)
  }

  const direction = interaction.direction
  if (!direction) return null
  const next = { ...start }
  const available = assistantAvailableSize(viewport)
  const minimumWidth = Math.min(ASSISTANT_MIN_WIDTH, available.width)
  const minimumHeight = Math.min(ASSISTANT_MIN_HEIGHT, available.height)

  if (direction.includes('w')) {
    const right = start.x + start.width
    next.width = clamp(start.width - dx, minimumWidth, right - ASSISTANT_EDGE_GAP)
    next.x = right - next.width
  } else if (direction.includes('e')) {
    next.width = clamp(start.width + dx, minimumWidth, viewport.width - start.x - ASSISTANT_EDGE_GAP)
  }

  if (direction.includes('n')) {
    const bottom = start.y + start.height
    next.height = clamp(start.height - dy, minimumHeight, bottom - ASSISTANT_EDGE_GAP)
    next.y = bottom - next.height
  } else if (direction.includes('s')) {
    next.height = clamp(start.height + dy, minimumHeight, viewport.height - start.y - ASSISTANT_EDGE_GAP)
  }

  return clampAssistantDialogGeometry(next, viewport)
}

export function canFinishAssistantDialogInteraction(
  interaction: AssistantDialogInteraction,
  pointerId: number
): boolean {
  return interaction.pointerId === pointerId
}
