import type { StudyTaskCategoryId, StudyTaskSchedule, StudyTaskScheduleInput } from '../../study-space/types'

export const MINUTES_PER_DAY = 24 * 60
export const SCHEDULE_STEP_MINUTES = 15
export const SCHEDULE_DAY_COUNT = 7

export type SchedulePointerGeometry = {
  top: number
  height: number
}

export type SchedulePointerProjection = {
  weekday: number
  minutes: number
}

export type ScheduleResizeEdge = 'start' | 'end'

export type TimeParts = {
  hour: number
  minute: number
}

export type TimeFieldPolicy = {
  minMinutes: number
  maxMinutes: number
  isDisabled?: (minutes: number) => boolean
}

export type TimeFieldValidation =
  | { valid: true; minutes: number }
  | { valid: false; message: '请输入有效的小时和分钟' | '结束时间必须晚于开始时间' }

export type ScheduleTaskProposal = {
  title: string
  categoryId: StudyTaskCategoryId
  schedule: StudyTaskScheduleInput
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function isScheduleDay(weekday: number): boolean {
  return Number.isInteger(weekday) && weekday >= 0 && weekday < SCHEDULE_DAY_COUNT
}

export function currentWeekdayIndex(date = new Date()): number {
  return (date.getDay() + 6) % SCHEDULE_DAY_COUNT
}

export function createDefaultSchedule(date = new Date()): StudyTaskScheduleInput {
  return { weekday: currentWeekdayIndex(date), startMinutes: 9 * 60, endMinutes: 10 * 60 }
}

export function formatScheduleMinutes(minutes: number): string {
  if (minutes >= MINUTES_PER_DAY) return '24:00'
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function getTimeParts(minutes: number): TimeParts {
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 }
}

export function parseTimePart(value: string, max: number): number | null {
  if (!/^\d{1,2}$/.test(value.trim())) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null
}

export function parseTimeParts(
  hourValue: string,
  minuteValue: string,
  minMinutes: number,
  maxMinutes: number
): number | null {
  const hour = parseTimePart(hourValue, 24)
  const minute = parseTimePart(minuteValue, 59)
  if (hour === null || minute === null || (hour === 24 && minute !== 0)) return null
  const totalMinutes = hour * 60 + minute
  return totalMinutes >= minMinutes && totalMinutes <= maxMinutes ? totalMinutes : null
}

export function canUseScheduleTime(hour: number, minute: number, policy: TimeFieldPolicy): boolean {
  const totalMinutes = hour * 60 + minute
  if (hour === 24 && minute !== 0) return false
  if (totalMinutes < policy.minMinutes || totalMinutes > policy.maxMinutes) return false
  return !(policy.isDisabled?.(totalMinutes) ?? false)
}

export function validateTimeFields(
  hourValue: string,
  minuteValue: string,
  policy: TimeFieldPolicy
): TimeFieldValidation {
  const minutes = parseTimeParts(hourValue, minuteValue, policy.minMinutes, policy.maxMinutes)
  if (minutes === null) return { valid: false, message: '请输入有效的小时和分钟' }
  if (policy.isDisabled?.(minutes)) return { valid: false, message: '结束时间必须晚于开始时间' }
  return { valid: true, minutes }
}

export function chooseAllowedMinute(
  hour: number,
  preferredMinute: number,
  policy: TimeFieldPolicy
): number | null {
  const allowed = Array.from({ length: 60 }, (_, minute) => minute)
    .filter((minute) => canUseScheduleTime(hour, minute, policy))
  if (allowed.length === 0) return null
  return allowed.reduce(
    (closest, candidate) => (
      Math.abs(candidate - preferredMinute) < Math.abs(closest - preferredMinute) ? candidate : closest
    ),
    allowed[0] ?? 0
  )
}

export function getMinutesFromPointer(geometry: SchedulePointerGeometry, clientY: number): number {
  const ratio = geometry.height > 0 ? (clientY - geometry.top) / geometry.height : 0
  return clamp(Math.round(ratio * MINUTES_PER_DAY), 0, MINUTES_PER_DAY)
}

export function projectDayPointer(
  weekday: number,
  geometry: SchedulePointerGeometry,
  clientY: number
): SchedulePointerProjection | null {
  if (!isScheduleDay(weekday)) return null
  return { weekday, minutes: getMinutesFromPointer(geometry, clientY) }
}

export function snapMinutesToStep(minutes: number): number {
  return Math.round(minutes / SCHEDULE_STEP_MINUTES) * SCHEDULE_STEP_MINUTES
}

export function getPointerGrabOffsetMinutes(
  geometry: SchedulePointerGeometry,
  clientY: number,
  durationMinutes: number
): number {
  const relativeY = clamp(clientY - geometry.top, 0, geometry.height)
  return relativeY / Math.max(1, geometry.height) * durationMinutes
}

export function clampScheduleDuration(durationMinutes: number): number {
  return clamp(durationMinutes, SCHEDULE_STEP_MINUTES, MINUTES_PER_DAY)
}

export function projectTaskDragSchedule(
  originSchedule: StudyTaskSchedule,
  pointer: SchedulePointerProjection | null,
  grabOffsetMinutes: number,
  durationMinutes: number
): StudyTaskScheduleInput | null {
  if (!pointer || !isScheduleDay(pointer.weekday)) return null
  const safeDuration = clampScheduleDuration(durationMinutes)
  const startMinutes = clamp(
    snapMinutesToStep(pointer.minutes - grabOffsetMinutes),
    0,
    MINUTES_PER_DAY - safeDuration
  )
  return {
    ...originSchedule,
    weekday: pointer.weekday,
    startMinutes,
    endMinutes: startMinutes + safeDuration
  }
}

export function projectTaskResizeSchedule(
  originSchedule: StudyTaskSchedule,
  pointerMinutes: number,
  edge: ScheduleResizeEdge
): StudyTaskScheduleInput {
  const snapped = snapMinutesToStep(pointerMinutes)
  if (edge === 'start') {
    return {
      ...originSchedule,
      startMinutes: clamp(snapped, 0, originSchedule.endMinutes - SCHEDULE_STEP_MINUTES)
    }
  }
  return {
    ...originSchedule,
    endMinutes: clamp(snapped, originSchedule.startMinutes + SCHEDULE_STEP_MINUTES, MINUTES_PER_DAY)
  }
}

export function createSelectionSchedule(
  weekday: number,
  anchorMinutes: number,
  currentMinutes: number,
  requireDrag = false
): StudyTaskScheduleInput | null {
  if (!isScheduleDay(weekday)) return null
  if (requireDrag && Math.abs(currentMinutes - anchorMinutes) < 8) return null
  const lowerMinutes = Math.min(anchorMinutes, currentMinutes)
  const upperMinutes = Math.max(anchorMinutes, currentMinutes)
  const snappedStart = Math.floor(lowerMinutes / SCHEDULE_STEP_MINUTES) * SCHEDULE_STEP_MINUTES
  const snappedEnd = Math.ceil(upperMinutes / SCHEDULE_STEP_MINUTES) * SCHEDULE_STEP_MINUTES
  const startMinutes = clamp(snappedStart, 0, MINUTES_PER_DAY - SCHEDULE_STEP_MINUTES)
  const endMinutes = clamp(
    Math.max(snappedEnd, startMinutes + SCHEDULE_STEP_MINUTES),
    startMinutes + SCHEDULE_STEP_MINUTES,
    MINUTES_PER_DAY
  )
  return { weekday, startMinutes, endMinutes }
}

export function patchSchedule(
  schedule: StudyTaskScheduleInput,
  patch: Partial<StudyTaskScheduleInput>
): StudyTaskScheduleInput {
  const nextSchedule = { ...schedule, ...patch }
  if (nextSchedule.endMinutes <= nextSchedule.startMinutes) {
    nextSchedule.endMinutes = Math.min(MINUTES_PER_DAY, nextSchedule.startMinutes + 60)
  }
  return nextSchedule
}

export function createScheduleTaskProposal(
  schedule: StudyTaskScheduleInput,
  categoryId: StudyTaskCategoryId = 'study'
): ScheduleTaskProposal {
  return { title: '', categoryId, schedule: { ...schedule } }
}