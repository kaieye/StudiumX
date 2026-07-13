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
const PET_CONTEXT_MENU_WIDTH = 172
const PET_CONTEXT_MENU_HEIGHT = 48
const ASSISTANT_EDGE_GAP = 16
const ASSISTANT_MIN_WIDTH = 300
const ASSISTANT_MIN_HEIGHT = 320
const ASSISTANT_DEFAULT_WIDTH = 380
const ASSISTANT_DEFAULT_HEIGHT = 560

export type PetPoint = { x: number; y: number }
export type PetPlacement = PetPoint
export type FloatingSurfaceSize = { width: number; height: number }
export type InteractionViewport = { width: number; height: number }
export type AssistantDialogGeometry = PetPlacement & FloatingSurfaceSize
export type AssistantDialogResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw'
export type AssistantDialogInteractionMode = 'drag' | 'resize'

export type PetDragSession = {
  pointerId: number
  startPoint: PetPoint
  startPlacement: PetPlacement
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

export function startPetDrag(
  pointerId: number,
  startPoint: PetPoint,
  startPlacement: PetPlacement
): PetDragSession {
  return { pointerId, startPoint, startPlacement, moved: false }
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
  const moved = session.moved || Math.hypot(dx, dy) >= PET_DRAG_THRESHOLD
  const nextSession = moved === session.moved ? session : { ...session, moved }
  if (!moved) return { session: nextSession, placement: null, direction: null }

  return {
    session: nextSession,
    placement: clampPetPlacement(
      { x: session.startPlacement.x + dx, y: session.startPlacement.y + dy },
      viewport,
      size
    ),
    direction: dx < 0 ? 'left' : 'right'
  }
}

export function finishPetDrag(
  session: PetDragSession,
  pointerId: number
): 'ignore' | 'persist-placement' | 'activate-assistant' {
  if (session.pointerId !== pointerId) return 'ignore'
  return session.moved ? 'persist-placement' : 'activate-assistant'
}

export function derivePetAttention(input: {
  waiting: boolean
  failed: boolean
  reviewVisible: boolean
  busy: boolean
  introVisible: boolean
  hovered: boolean
  dragDirection: 'left' | 'right' | null
  showStatusBubble: boolean
}): { baseState: PetAttentionState; visualState: PetAttentionState; showBubble: boolean } {
  const baseState: PetAttentionState = input.waiting
    ? 'waiting'
    : input.failed
      ? 'failed'
      : input.reviewVisible
        ? 'review'
        : input.busy
          ? 'running'
          : input.introVisible
            ? 'waving'
            : 'idle'
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